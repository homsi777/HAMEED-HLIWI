import { BadRequestException, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { appConfig } from '../config/app-config.js';
import { PermissionGuard } from '../permissions/permission.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const signatures: Record<string, (body: Buffer) => boolean> = {
  'image/jpeg': body => body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff,
  'image/png': body => body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': body => body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP',
};
@Controller('inventory/images') @UseGuards(AuthGuard, PermissionGuard)
export class InventoryImagesController {
  @Post() @RequirePermissions('inventory.create')
  async upload(@Req() request: FastifyRequest) { const type = request.headers['content-type']?.split(';', 1)[0] ?? ''; const extension = extensions[type]; const body = request.body; if (!extension || !Buffer.isBuffer(body) || !body.length || body.length > appConfig().uploadMaxBytes || !signatures[type]?.(body)) throw new BadRequestException('Image must be a valid JPEG, PNG, or WebP and within the allowed size.'); const filename = `${randomUUID()}.${extension}`; await writeFile(resolve(process.cwd(), appConfig().uploadDirectory, filename), body, { flag: 'wx' }); return { imagePath: filename, imageUrl: `/uploads/inventory/${filename}` }; }
}
