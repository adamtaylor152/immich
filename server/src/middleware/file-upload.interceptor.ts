import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { transformException } from '@nestjs/platform-express/multer/multer/multer.utils';
import { NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import { Observable } from 'rxjs';
import { UploadFieldName } from 'src/dtos/asset-media.dto';
import { RouteKey } from 'src/enum';
import { AuthRequest } from 'src/middleware/auth.guard';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { AssetMediaService } from 'src/services/asset-media.service';
import { ImmichFile, UploadFile, UploadFiles } from 'src/types';
import { asUploadRequest, mapToUploadFile } from 'src/utils/asset.util';

export function getFile(files: UploadFiles, property: 'assetData' | 'sidecarData') {
  const file = files[property]?.[0];
  return file ? mapToUploadFile(file) : file;
}

export function getFiles(files: UploadFiles) {
  return {
    file: getFile(files, 'assetData') as UploadFile,
    sidecarFile: getFile(files, 'sidecarData'),
  };
}

type ImmichMulterFile = Express.Multer.File & { uuid: string };

interface Callback<T> {
  (error: Error): void;
  (error: null, result: T): void;
}

@Injectable()
export class FileUploadInterceptor implements NestInterceptor {
  private handlers: {
    userProfile: RequestHandler;
    assetUpload: RequestHandler;
  };

  constructor(
    private reflect: Reflector,
    private assetService: AssetMediaService,
    private storageRepository: StorageRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FileUploadInterceptor.name);

    const instance = multer({
      fileFilter: this.fileFilter.bind(this),
      storage: {
        _handleFile: this.handleFile.bind(this),
        _removeFile: this.removeFile.bind(this),
      },
    });

    this.handlers = {
      userProfile: instance.single(UploadFieldName.PROFILE_DATA),
      assetUpload: instance.fields([
        { name: UploadFieldName.ASSET_DATA, maxCount: 1 },
        { name: UploadFieldName.SIDECAR_DATA, maxCount: 1 },
      ]),
    };
  }

  async intercept(context: ExecutionContext, next: CallHandler<any>): Promise<Observable<any>> {
    const context_ = context.switchToHttp();
    const route = this.reflect.get<string>(PATH_METADATA, context.getClass());

    const handler: RequestHandler | null = this.getHandler(route as RouteKey);
    if (handler) {
      await new Promise<void>((resolve, reject) => {
        const next: NextFunction = (error) => (error ? reject(transformException(error)) : resolve());
        const maybePromise = handler(context_.getRequest(), context_.getResponse(), next);
        Promise.resolve(maybePromise).catch((error) => reject(error));
      });
    } else {
      this.logger.warn(`Skipping invalid file upload route: ${route}`);
    }

    return next.handle();
  }

  private fileFilter(request: AuthRequest, file: Express.Multer.File, callback: multer.FileFilterCallback) {
    try {
      callback(null, this.assetService.canUploadFile(asUploadRequest(request, file)));
    } catch (error: Error | any) {
      callback(error);
    }
  }

  private handleFile(request: AuthRequest, file: Express.Multer.File, callback: Callback<Partial<ImmichFile>>) {
    request.on('error', (error) => {
      this.logger.warn('Request error while uploading file, cleaning up', error);
      this.assetService.onUploadError(request, file).catch(this.logger.error);
    });

    try {
      (file as ImmichMulterFile).uuid = randomUUID();

      const uploadRequest = asUploadRequest(request, file);

      const path = join(
        this.assetService.getUploadFolder(uploadRequest),
        this.assetService.getUploadFilename(uploadRequest),
      );

      const writeStream = this.storageRepository.createWriteStream(path);
      // SECURITY DEFERRED (SHAttered / CWE-327): The checksum below is still
      // SHA-1. A real upgrade to SHA-256 would touch the server checksum
      // pipeline, the OpenAPI types regenerated for web/mobile SDKs, the web
      // client-side hasher (`web/src/lib/workers/hash-file.ts` uses
      // `@noble/hashes/legacy.js` for SHA-1), the dedup linker, and all
      // existing rows in `asset.checksum` — well above the safe scope for a
      // single mitigation patch. SHA-1 is preserved here so duplicate
      // detection, library scan, and existing client integrations keep
      // working. The physical-dedup feature's same-tenant + matching
      // `fileSizeInByte` gate is the partial mitigation that ships now.
      //
      // TODO(security/M1): Implement a real SHA-256 transition. Tracking
      // task: add a `ChecksumAlgorithm.sha256File` enum value; tee a second
      // SHA-256 hasher in this interceptor; persist it on new uploads; and
      // add a SHA-256 confirmation pass in
      // `getPhysicalDeduplicationCandidate` before linking cross-tenant
      // storage. See `.claude/review/verify-integration.md` "Thread 4" and
      // security.md M1 for the SHAttered finding.
      const hash = file.fieldname === UploadFieldName.ASSET_DATA ? createHash('sha1') : null;

      let size = 0;

      file.stream.on('data', (chunk) => {
        hash?.update(chunk);
        size += chunk.length;
      });

      pipeline(file.stream, writeStream, (error) => {
        if (error) {
          hash?.destroy();
          return callback(error);
        }
        callback(null, {
          path,
          size,
          checksum: hash?.digest(),
        });
      });
    } catch (error: Error | any) {
      callback(error);
    }
  }

  private removeFile(_request: AuthRequest, file: Express.Multer.File, callback: (error: Error | null) => void) {
    this.storageRepository
      .unlink(file.path)
      .then(() => callback(null))
      .catch(callback);
  }

  private getHandler(route: RouteKey) {
    switch (route) {
      case RouteKey.Asset: {
        return this.handlers.assetUpload;
      }

      case RouteKey.User: {
        return this.handlers.userProfile;
      }

      default: {
        return null;
      }
    }
  }
}
