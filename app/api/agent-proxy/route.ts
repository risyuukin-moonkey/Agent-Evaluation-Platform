export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      url: string;
      method: "POST" | "GET";
      headers: Record<string, string>;
      body?: string;
      timeoutSeconds?: number;
    };

    if (!payload.url || !/^https?:\/\//i.test(payload.url)) {
      return Response.json({ error: "Agent endpoint must be an http(s) URL." }, { status: 400 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), (payload.timeoutSeconds ?? 30) * 1000);
    const agentResponse = await fetch(payload.url, {
      method: payload.method,
      headers: payload.headers,
      body: payload.method === "POST" ? payload.body : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const contentType = agentResponse.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("application/json") ? await agentResponse.json() : await agentResponse.text();

    return Response.json({
      ok: agentResponse.ok,
      status: agentResponse.status,
      contentType,
      body: responseBody,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Agent proxy request failed.",
      },
      { status: 500 },
    );
  }
}
