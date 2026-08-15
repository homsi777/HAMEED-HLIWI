import { Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { BackupsService } from './backups.service.js';

// Every route here is behind `backups.manage`, including the download. `PermissionGuard` sits
// beside `AuthGuard` deliberately — without it `@RequirePermissions` does nothing at all.
@Controller('backups')
@UseGuards(AuthGuard, PermissionGuard)
export class BackupsController {
  constructor(@Inject(BackupsService) private readonly backups: BackupsService) {}

  @Get() @RequirePermissions('backups.manage')
  list() { return this.backups.list(); }

  @Post() @RequirePermissions('backups.manage')
  create(@Req() request: FastifyRequest) { return this.backups.create(request.identity!); }

  @Post(':id/ticket') @RequirePermissions('backups.manage')
  ticket(@Req() request: FastifyRequest, @Param('id') id: string) { return this.backups.issueTicket(request.identity!, id); }

  /**
   * TASK 20 §17: a real HTTP response with `Content-Disposition`, not a JavaScript blob.
   *
   * Script-generated downloads are the least reliable path on mobile and the first thing to break
   * inside an installed PWA shell. A plain navigation to this route carries the session cookie and
   * lets the browser hand the file to the Files app or the Downloads folder itself.
   */
  @Get('download/:token') @RequirePermissions('backups.manage')
  async download(@Req() request: FastifyRequest, @Param('token') token: string, @Res() reply: FastifyReply) {
    const file = await this.backups.redeem(request.identity!, token);
    return reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Length', String(file.sizeBytes))
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(file.filePath));
  }
}
