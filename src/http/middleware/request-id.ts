/**
 * Middleware request-id — corrélation des logs.
 *
 * Injecte un requestId ULID dans chaque requête si absent.
 * Le requestId est :
 *   - Lu depuis le header X-Request-Id si présent et valide
 *   - Généré avec ulid() sinon
 *
 * Retourné dans le header X-Request-Id de la réponse.
 * Automatiquement inclus dans tous les logs pino via requestIdLogLabel.
 *
 * Note : Fastify injecte déjà req.id depuis requestIdHeader: 'x-request-id'.
 * Ce middleware ajoute X-Request-Id dans la réponse pour la corrélation client.
 */
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify'

export function requestIdHook(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  // Fastify génère req.id automatiquement depuis x-request-id ou génère un ulid
  // On le réinjecte dans la réponse pour que le client puisse tracer
  reply.header('X-Request-Id', request.id)
  done()
}
