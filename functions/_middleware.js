const tokenParameterName = "key";
const tokenSecretName = "SITE_ACCESS_TOKEN";

function isApplicationDocument(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const { pathname } = new URL(request.url);
  return pathname === "/" || pathname === "/index.html";
}

function isStaticResource(pathname) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/env/") ||
    pathname.startsWith("/leaflet/") ||
    (pathname.startsWith("/workbox-") && pathname.endsWith(".js")) ||
    [
      "/favicon.ico",
      "/icon180.png",
      "/icon192.png",
      "/icon512.png",
      "/manifest.webmanifest",
      "/registerSW.js",
      "/sw.js",
    ].includes(pathname)
  );
}

function forbiddenResponse(message) {
  return new Response(message, {
    status: 403,
    headers: {
      "Content-Type": "text/plain; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

export function onRequest(context) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  // ページ本体だけを保護する。ページ内で読み込まれる /env/ 配下の画像・SVG・
  // JS・JSON などはクエリ文字列を自動継承しないため、対象にすると表示が壊れる。
  if (request.method !== "GET" && request.method !== "HEAD") {
    return context.next();
  }

  if (!isApplicationDocument(request)) {
    if (isStaticResource(requestUrl.pathname)) return context.next();

    console.log("[access-debug] rejected unknown path", {
      url: request.url,
      method: request.method,
    });
    return forbiddenResponse("このURLは利用できません。");
  }

  const expectedToken = env[tokenSecretName];
  const loggedUrl = new URL(requestUrl);
  loggedUrl.searchParams.delete(tokenParameterName);
  console.log("[access-debug] application document request", {
    url: loggedUrl.toString(),
    query: Object.fromEntries(
      [...requestUrl.searchParams].map(([name, value]) => [
        name,
        name === tokenParameterName ? "[redacted]" : value,
      ]),
    ),
    method: request.method,
    tokenSecretName,
    configured: Boolean(expectedToken),
  });

  if (!expectedToken) {
    return new Response(
      "サーバーのアクセス設定が完了していません。管理者にお問い合わせください。",
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const suppliedToken = requestUrl.searchParams.get(tokenParameterName);
  if (suppliedToken !== expectedToken) {
    return forbiddenResponse(
      "アクセスが許可されていません。Power Apps に設定された正しいURLから開いてください。",
    );
  }

  return context.next();
}
