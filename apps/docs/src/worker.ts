interface Fetcher {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return serveRoot(request, env);
    }

    if (url.pathname === "/llms.txt") {
      const asset = await env.ASSETS.fetch(request);
      return rewriteAsMarkdown(asset, { varyOnAccept: false });
    }

    return env.ASSETS.fetch(request);
  },
};

async function serveRoot(request: Request, env: Env): Promise<Response> {
  const acceptsMarkdown = request.headers.get("Accept")?.includes("text/markdown");

  if (acceptsMarkdown) {
    const asset = await env.ASSETS.fetch(new URL("/llms.txt", request.url), {
      headers: request.headers,
    });
    return rewriteAsMarkdown(asset, { varyOnAccept: true });
  }

  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  headers.set("Vary", "Accept");
  return new Response(asset.body, { status: asset.status, headers });
}

function rewriteAsMarkdown(asset: Response, options: { varyOnAccept: boolean }): Response {
  const headers = new Headers(asset.headers);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=300, must-revalidate");
  if (options.varyOnAccept) headers.set("Vary", "Accept");
  return new Response(asset.body, { status: asset.status, headers });
}
