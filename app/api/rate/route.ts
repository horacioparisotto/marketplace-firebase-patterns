// Next.js route handler in the admin panel: the target of the one-tap rating
// link in the post-event email.
//
// Mail scanners open links on their own, so GET only renders a page; the vote
// itself is a POST that the page sends with JavaScript, which scanners don't
// run. A scanner can preview the link, but it can't cast a rating.
import { adminDb } from '../../../src/firebase';
import { readVote, recordVote } from '../../../src/ratings';

const secret = () => process.env.RATING_LINK_SECRET ?? '';

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!readVote(token, secret())) return page('This link is no longer valid.');
  return page(
    'Sending your rating…',
    `<form method="post"><input type="hidden" name="t" value="${escapeHtml(token)}"></form>
     <script>document.forms[0].submit()</script>`,
  );
}

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const vote = readVote(String(form.get('t') ?? ''), secret());
  if (!vote) return page('This link is no longer valid.');

  await recordVote(adminDb(), vote, new Date());
  return page('Thanks for your rating!');
}

function page(message: string, extra = ''): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><p>${escapeHtml(message)}</p>${extra}`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
