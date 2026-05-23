import _ from 'lodash';
import { defaults } from 'src/config';
import { SystemConfigController } from 'src/controllers/system-config.controller';
import { StorageTemplateService } from 'src/services/storage-template.service';
import { SystemConfigService } from 'src/services/system-config.service';
import request from 'supertest';
import { errorDto } from 'test/medium/responses';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

/** Returns a full config that passes Zod validation (required URLs and min lengths). */
function validConfig() {
  const config = _.cloneDeep(defaults) as typeof defaults & {
    oauth: { mobileRedirectUri: string };
    notifications: { smtp: { from: string; transport: { host: string } } };
    server: { externalDomain: string };
  };
  config.oauth.mobileRedirectUri = config.oauth.mobileRedirectUri || 'https://example.com';
  config.server.externalDomain = config.server.externalDomain || 'https://example.com';
  config.notifications.smtp.from = config.notifications.smtp.from || 'noreply@example.com';
  config.notifications.smtp.transport.host = config.notifications.smtp.transport.host || 'localhost';
  return config;
}

describe(SystemConfigController.name, () => {
  let ctx: ControllerContext;
  const systemConfigService = mockBaseService(SystemConfigService);
  const templateService = mockBaseService(StorageTemplateService);

  beforeAll(async () => {
    ctx = await controllerSetup(SystemConfigController, [
      { provide: SystemConfigService, useValue: systemConfigService },
      { provide: StorageTemplateService, useValue: templateService },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    systemConfigService.resetAllMocks();
    templateService.resetAllMocks();
    ctx.reset();
  });

  describe('GET /system-config', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/system-config');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('GET /system-config/defaults', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/system-config/defaults');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('GET /system-config/machine-learning/hardware', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/system-config/machine-learning/hardware');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('PUT /system-config', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put('/system-config');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    describe('nightlyTasks', () => {
      it('should validate nightly jobs start time', async () => {
        const config = validConfig();
        config.nightlyTasks.startTime = 'invalid';
        const { status, body } = await request(ctx.getHttpServer()).put('/system-config').send(config);
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            {
              path: ['nightlyTasks', 'startTime'],
              message: 'Invalid input: expected string in HH:mm format, received string',
            },
          ]),
        );
      });

      it('should accept a valid time', async () => {
        const config = validConfig();
        config.nightlyTasks.startTime = '05:05';
        const { status } = await request(ctx.getHttpServer()).put('/system-config').send(config);
        expect(status).toBe(200);
      });

      it('should validate a boolean field', async () => {
        const config = validConfig();
        (config.nightlyTasks.databaseCleanup as any) = 'invalid';
        const { status, body } = await request(ctx.getHttpServer()).put('/system-config').send(config);
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            { path: ['nightlyTasks', 'databaseCleanup'], message: 'Invalid input: expected boolean, received string' },
          ]),
        );
      });
    });

    it('should accept config without newer image enrichment settings', async () => {
      const config = validConfig() as any;
      delete config.job.imageEnrichment;
      delete config.job.imageDescription;
      delete config.job.nsfwDetection;
      delete config.machineLearning.imageDescription;
      delete config.machineLearning.nsfwDetection;
      const { status } = await request(ctx.getHttpServer()).put('/system-config').send(config);
      expect(status).toBe(200);
    });

    describe('image', () => {
      it('should accept config without optional progressive property', async () => {
        const config = validConfig();
        delete config.image.thumbnail.progressive;
        delete config.image.preview.progressive;
        delete config.image.fullsize.progressive;
        const { status } = await request(ctx.getHttpServer()).put('/system-config').send(config);
        expect(status).toBe(200);
      });

      it('should accept config with progressive set to true', async () => {
        const config = validConfig();
        config.image.thumbnail.progressive = true;
        config.image.preview.progressive = true;
        config.image.fullsize.progressive = true;
        const { status } = await request(ctx.getHttpServer()).put('/system-config').send(config);
        expect(status).toBe(200);
      });

      it('should reject invalid progressive value', async () => {
        const config = validConfig();
        (config.image.thumbnail.progressive as any) = 'invalid';
        const { status, body } = await request(ctx.getHttpServer()).put('/system-config').send(config);
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            {
              path: ['image', 'thumbnail', 'progressive'],
              message: 'Invalid input: expected boolean, received string',
            },
          ]),
        );
      });
    });
  });

  describe('GET /system-config/image-description/requeue-estimate', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/system-config/image-description/requeue-estimate');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('POST /system-config/image-description/requeue', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/system-config/image-description/requeue');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('GET /system-config/smart-albums/reevaluate-estimate', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/system-config/smart-albums/reevaluate-estimate');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('POST /system-config/smart-albums/reevaluate', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/system-config/smart-albums/reevaluate');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });
});
