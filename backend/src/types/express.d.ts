import "express";

declare global {
  namespace Express {
    interface User {
      uid: string;
      username?: string;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};