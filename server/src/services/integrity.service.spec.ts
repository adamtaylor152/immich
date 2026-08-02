import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ChecksumAlgorithm } from 'src/enum';
import { IntegrityService } from 'src/services/integrity.service';
import { newTestService, ServiceMocks } from 'test/utils';

describe(IntegrityService.name, () => {
  let sut: IntegrityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(IntegrityService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('handleChecksumFiles', () => {
    const contents = Buffer.from('the-file-bytes');
    const sha256 = createHash('sha256').update(contents).digest();
    const sha1 = createHash('sha1').update(contents).digest();

    const streamAsset = (checksum: Buffer, checksumAlgorithm: ChecksumAlgorithm) => {
      mocks.integrityReport.getAssetCount.mockResolvedValue({ count: 1 } as never);
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.integrityReport.streamAssetChecksums.mockReturnValue(
        (function* () {
          yield {
            assetId: 'asset-1',
            originalPath: '/data/library/asset-1.jpg',
            checksum,
            checksumAlgorithm,
            createdAt: new Date(),
            reportId: null,
          };
        })() as never,
      );
      mocks.storage.createPlainReadStream.mockReturnValue(Readable.from([contents]) as never);
    };

    it('should backfill a sha1 for a verified sha256 asset', async () => {
      // Clients pre-check duplicates with sha1; assets uploaded before that
      // digest was recorded get one here, off the verification read.
      streamAsset(sha256, ChecksumAlgorithm.sha256File);

      await sut.handleChecksumFiles({});

      expect(mocks.forkSchema.recordAssetChecksums).toHaveBeenCalledWith({
        assetId: 'asset-1',
        sha1,
        sha256,
        sizeInBytes: contents.length,
        path: '/data/library/asset-1.jpg',
        source: 'integrity',
      });
    });

    it('should not record digests for a sha1 asset', async () => {
      // Already matches what clients send; nothing to translate.
      streamAsset(sha1, ChecksumAlgorithm.sha1File);

      await sut.handleChecksumFiles({});

      expect(mocks.forkSchema.recordAssetChecksums).not.toHaveBeenCalled();
    });

    it('should not record digests when the file fails verification', async () => {
      streamAsset(createHash('sha256').update('different').digest(), ChecksumAlgorithm.sha256File);

      await sut.handleChecksumFiles({});

      expect(mocks.forkSchema.recordAssetChecksums).not.toHaveBeenCalled();
    });
  });

  describe('handleDeleteAllIntegrityReports', () => {
    beforeEach(() => {
      mocks.integrityReport.streamIntegrityReportsByProperty.mockReturnValue((function* () {})() as never);
    });

    it('should query all property types when no type specified', async () => {
      await sut.handleDeleteAllIntegrityReports({});

      expect(mocks.integrityReport.streamIntegrityReportsByProperty).toHaveBeenCalledWith(undefined, undefined);
      expect(mocks.integrityReport.streamIntegrityReportsByProperty).toHaveBeenCalledWith('assetId', undefined);
      expect(mocks.integrityReport.streamIntegrityReportsByProperty).toHaveBeenCalledWith('fileAssetId', undefined);
    });
  });
});
