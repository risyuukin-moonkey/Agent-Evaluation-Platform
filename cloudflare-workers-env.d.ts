declare module "cloudflare:workers" {
  export const env: {
    DB?: any;
  };
}

type Fetcher = {
  fetch(request: Request): Promise<Response>;
};

type D1Database = any;
