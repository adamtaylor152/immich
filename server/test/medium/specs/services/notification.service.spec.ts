import { Kysely } from 'kysely';
import { AssetFileType, AssetMetadataKey, JobName } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EmailRepository } from 'src/repositories/email.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { NotificationRepository } from 'src/repositories/notification.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { DB } from 'src/schema';
import { NotificationService } from 'src/services/notification.service';
import { clearConfigCache } from 'src/utils/config';
import { MediumTestContext, newMediumService } from 'test/medium.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(NotificationService, {
    database: db || defaultDatabase,
    real: [
      AlbumRepository,
      AssetJobRepository,
      AssetRepository,
      ConfigRepository,
      NotificationRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [EmailRepository, EventRepository, JobRepository, LoggingRepository, WebsocketRepository],
  });

  ctx.getMock(EmailRepository).renderEmail.mockResolvedValue({ html: '<html></html>', text: 'text' });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(WebsocketRepository).clientSend.mockReturnValue();

  return { sut, ctx };
};

const nsfwMetadata = (isNsfw: boolean) => ({
  nsfwDetection: {
    status: 'success',
    result: { isNsfw, score: isNsfw ? 0.95 : 0.05, labels: { explicit: isNsfw ? 0.95 : 0.05 } },
  },
});

const enableNsfwHiding = async (ctx: MediumTestContext) => {
  const config = await ctx.getConfig();
  await ctx.updateConfig({
    ...config,
    machineLearning: {
      ...config.machineLearning,
      nsfwDetection: { ...config.machineLearning.nsfwDetection, hideFromLibrary: true },
    },
  });
  clearConfigCache();
};

const newAlbumWithThumbnail = async (ctx: MediumTestContext, { isNsfw }: { isNsfw: boolean }) => {
  const { user: owner } = await ctx.newUser();
  const { user: recipient } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Thumbnail, path: '/path/to/thumbnail.webp' });
  if (isNsfw) {
    await ctx.newMetadata({ assetId: asset.id, key: AssetMetadataKey.MlEnrichment, value: nsfwMetadata(true) });
  }
  const { album } = await ctx.newAlbum({ ownerId: owner.id, albumThumbnailAssetId: asset.id });
  await ctx.newAlbumUser({ albumId: album.id, userId: recipient.id });
  return { owner, recipient, asset, album };
};

const getQueuedSendMail = (ctx: MediumTestContext) => {
  const calls = ctx.getMock(JobRepository).queue.mock.calls.filter(([job]) => job.name === JobName.SendMail);
  expect(calls).toHaveLength(1);
  return calls[0][0].data as { imageAttachments?: unknown[] };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

beforeEach(() => {
  clearConfigCache();
});

describe(NotificationService.name, () => {
  describe('handleAlbumInvite', () => {
    it('should blank the album thumbnail when it is NSFW', async () => {
      const { sut, ctx } = setup();
      await enableNsfwHiding(ctx);
      const { recipient, album, owner } = await newAlbumWithThumbnail(ctx, { isNsfw: true });

      await sut.handleAlbumInvite({ id: album.id, recipientId: recipient.id, senderName: owner.name });

      expect(getQueuedSendMail(ctx).imageAttachments).toBeUndefined();
    });

    it('should keep the album thumbnail when it is safe', async () => {
      const { sut, ctx } = setup();
      await enableNsfwHiding(ctx);
      const { recipient, album, owner } = await newAlbumWithThumbnail(ctx, { isNsfw: false });

      await sut.handleAlbumInvite({ id: album.id, recipientId: recipient.id, senderName: owner.name });

      expect(getQueuedSendMail(ctx).imageAttachments).toEqual([
        expect.objectContaining({ path: '/path/to/thumbnail.webp', cid: 'album-thumbnail' }),
      ]);
    });
  });

  describe('handleAlbumUpdate', () => {
    it('should blank the album thumbnail when it is NSFW', async () => {
      const { sut, ctx } = setup();
      await enableNsfwHiding(ctx);
      const { recipient, album } = await newAlbumWithThumbnail(ctx, { isNsfw: true });

      await sut.handleAlbumUpdate({ id: album.id, recipientId: recipient.id });

      expect(getQueuedSendMail(ctx).imageAttachments).toBeUndefined();
    });

    it('should keep the album thumbnail when it is safe', async () => {
      const { sut, ctx } = setup();
      await enableNsfwHiding(ctx);
      const { recipient, album } = await newAlbumWithThumbnail(ctx, { isNsfw: false });

      await sut.handleAlbumUpdate({ id: album.id, recipientId: recipient.id });

      expect(getQueuedSendMail(ctx).imageAttachments).toEqual([
        expect.objectContaining({ path: '/path/to/thumbnail.webp', cid: 'album-thumbnail' }),
      ]);
    });
  });
});
