export interface TokenPayload {
  user: string;
  exp: number;
}

function parseToken(token: string): TokenPayload | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const payload = JSON.parse(decoded);
    if (payload && typeof payload.user === "string" && typeof payload.exp === "number") {
      return payload;
    }
    return null;
  } catch (e) {
    return null;
  }
}
