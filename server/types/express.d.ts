import type { Principal } from "../platform/auth/authMiddleware.ts";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      principal?: Principal;
    }
  }
}

export {};
