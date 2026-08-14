import { Global, Module } from '@nestjs/common';
import { DocumentNumberService } from './document-number.service.js';
import { RequestContextService } from './request-context.service.js';

@Global()
@Module({ providers: [RequestContextService, DocumentNumberService], exports: [RequestContextService, DocumentNumberService] })
export class CommonModule {}
