import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sanitizeNextPath } from "@/lib/url";

const PROTECTED_PREFIXES = ["/share", "/settings", "/notifications", "/onboarding"];

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isProtected || req.auth?.user) {
    return NextResponse.next();
  }
  const safeNext = sanitizeNextPath(`${pathname}${search}`);
  const loginUrl = new URL("/login", req.url);
  if (safeNext !== "/") loginUrl.searchParams.set("next", safeNext);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: ["/share/:path*", "/settings/:path*", "/notifications/:path*", "/onboarding/:path*"],
};
