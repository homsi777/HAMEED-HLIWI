import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const isHttp = exception instanceof HttpException || (typeof exception === 'object' && exception !== null && 'getStatus' in exception && typeof (exception as HttpException).getStatus === 'function');
    const fastifyStatus = typeof exception === 'object' && exception !== null && 'statusCode' in exception && typeof (exception as { statusCode?: unknown }).statusCode === 'number' ? (exception as { statusCode: number }).statusCode : undefined;
    const status = isHttp ? (exception as HttpException).getStatus() : fastifyStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = isHttp ? (exception as HttpException).getResponse() : undefined;
    if (!isHttp && status >= HttpStatus.INTERNAL_SERVER_ERROR) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    const message = typeof detail === 'object' && detail && 'message' in detail ? (detail as { message: unknown }).message : isHttp ? (exception as Error).message : 'Internal server error';
    response.status(status).send({ statusCode: status, error: HttpStatus[status], message, requestId: request.id });
  }
}
