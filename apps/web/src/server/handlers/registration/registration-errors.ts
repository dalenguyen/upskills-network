/**
 * Registration-specific status helpers.
 *
 * The two functions themselves live in `../http-error.ts`, next to the
 * `toHttpError` mapping, so every route answers with the same error shape.
 * These aliases keep the registration handlers reading like the domain they
 * serve.
 */
export { conflict, forbidden } from '../http-error';
