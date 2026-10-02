#!/usr/bin/env node
/**
 * email-html.mjs — Tailored HTML rendering for job-hunt outreach.
 *
 * Converts a plain-text application body into a branded, inline-styled HTML
 * email styled like jayesh-ux.github.io/jayesh-singh (dark "systems" theme:
 * ink panels, teal accent, brush gradient, mono boot labels). Smooth gradients
 * are faked with solid-cell strips because email clients strip CSS gradients.
 *
 * All styles inlined (email-safe) in a single-column table layout.
 * Single-user profile (Jayesh Singh); facts come from cv.md / profile.yml.
 *
 * Exports: escapeHtml, encodeMimeSubject, bodyToHtml, mimeAlternative, attachmentPart
 */

const ACCENT = '#00a0b8';        // teal primary
const ACCENT_DIM = '#2fbccf';
const CYAN = '#4dd9e0';
const LIME = '#aeba27';
const YELLOW = '#f5cb01';
const INK = '#0a0c0e';           // page bg
const INK_CARD = '#131519';      // card bg
const LINE = '#25272c';          // borders
const FG = '#f2f2ed';            // primary text
const FG_SOFT = '#c9c7be';       // secondary text
const MUTE = '#868680';          // muted text
const MONO = "'JetBrains Mono',Consolas,'Courier New',monospace";
const DISPLAY = "'Space Grotesk','Trebuchet MS',sans-serif";
const BODYFONT = "'Inter',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

export function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeQuotedPrintable(text) {
  return String(text)
    .replace(/[^\x20-\x7E\r\n]/g, (ch) => '=' + ch.charCodeAt(0).toString(16).toUpperCase())
    .replace(/\r\n|\r|\n/g, '\r\n');
}

function encodeSubject(subject) {
  let result = '';
  for (let i = 0; i < subject.length; i++) {
    const c = subject.charCodeAt(i);
    if (c > 127 || c === 61 || c === 63 || c === 95) {
      const hex = subject.charCodeAt(i).toString(16).toUpperCase();
      result += '=' + (hex.length === 1 ? '0' : '') + hex;
    } else {
      result += subject[i];
    }
  }
  return result;
}

/** RFC 2047 encoded-words header value. */
export function encodeMimeSubject(subject) {
  return `=?UTF-8?Q?${encodeSubject(subject)}?=`;
}

/** Contact meta — single-user (Jayesh Singh). Senders may override. */
function contactMeta() {
  return {
    name: 'Jayesh Singh',
    title: 'Full Stack Engineer / AI Systems Builder',
    phone: '+91-7821816193',
    email: 'hsinghjayesh@gmail.com',
    location: 'Kalyan (W) · Mumbai — India',
    linkedin: 'https://linkedin.com/in/jayesh-dev',
    github: 'https://github.com/Jayesh-ux',
    portfolio: 'https://jayesh-ux.github.io/jayesh-singh/',
  };
}

/** Brush gradient strip — 4 solid cells (email-safe gradient). */
function brushStrip() {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    <td class="brush-cell" style="width:25%;height:4px;font-size:1px;line-height:1px;background:${ACCENT}"></td>
    <td class="brush-cell" style="width:25%;height:4px;font-size:1px;line-height:1px;background:${CYAN}"></td>
    <td class="brush-cell" style="width:25%;height:4px;font-size:1px;line-height:1px;background:${LIME}"></td>
    <td class="brush-cell" style="width:25%;height:4px;font-size:1px;line-height:1px;background:${YELLOW}"></td>
  </tr></table>`;
}

/** Small uppercase mono section label with numbered chip. */
function sectionLabel(num, text) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 10px 0"><tr>
    <td style="padding:3px 10px;border-radius:999px;border:1px solid ${ACCENT}40;background:${ACCENT}0f;font-family:${MONO};font-size:11px;letter-spacing:.12em;color:${CYAN};white-space:nowrap">${num}&nbsp;&nbsp;${escapeHtml(text)}</td>
  </tr></table>`;
}

/** Signature block styled like the portfolio footer. */
function signatureHtml() {
  const c = contactMeta();
  return `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;padding-top:16px;border-top:1px solid ${LINE}">
            <tr>
              <td class="sig-avatar" style="vertical-align:middle;padding-right:14px;width:46px">
                <span style="display:inline-block;width:42px;height:42px;line-height:42px;text-align:center;border-radius:8px;font-family:${MONO};font-weight:700;font-size:15px;color:${CYAN};background:${INK_CARD};border:1px solid ${ACCENT}66">JS</span>
              </td>
              <td class="sig-meta" style="vertical-align:middle">
                <div style="font-family:${MONO};font-size:11px;letter-spacing:.14em;color:${CYAN}">BEST REGARDS</div>
                <div style="font-family:${DISPLAY};font-size:18px;font-weight:700;color:${FG};margin-top:2px">${c.name}</div>
                <div style="font-family:${BODYFONT};font-size:12px;color:${MUTE};margin-top:2px">${c.phone} &middot; ${c.location}</div>
              </td>
            </tr>
          </table>
          <table class="sig-btns" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px">
            <tr>
              <td style="padding:0;font-size:0;line-height:0">${sigBtns(c)}</td>
            </tr>
          </table>`;
}

function sigBtns(c) {
  const btns = [
    [`mailto:${c.email}`, 'E-MAIL'],
    [c.github, 'GITHUB'],
    [c.linkedin, 'LINKEDIN'],
    [c.portfolio, 'PORTFOLIO'],
  ];
  return btns.map(([href, label], i) => `<span class="sig-btn" style="display:inline-block;margin:0 8px 8px 0;background:${INK_CARD}"><a href="${href}" style="display:inline-block;font-family:${MONO};font-size:11px;color:${CYAN};text-decoration:none;border:1px solid ${ACCENT}66;border-radius:999px;padding:5px 12px;">${label}</a></span>`).join('');
}

function statChips() {
  const chips = [
    { n: '700+', l: 'CLIENTS SERVED' },
    { n: 'Llama 3.3', l: '70B DEPLOYED' },
    { n: '96TB', l: 'STORAGE STOOD UP' },
  ];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:14px 0 0 0"><tr>
  ${chips.map((chip) => `<td class="chip" style="padding:0;font-size:0;line-height:0"><div style="background:${INK_CARD};border:1px solid ${LINE};border-radius:10px;padding:10px 12px;margin:0 0 0 0">
        <div style="font-family:${DISPLAY};font-size:16px;font-weight:700;color:${CYAN};line-height:1.2">${chip.n}</div>
        <div style="font-family:${MONO};font-size:9px;letter-spacing:.06em;color:${MUTE};margin-top:3px">${chip.l}</div>
      </div></td>`).join('\n\t')
}
  </tr></table>`;
}

/**
 * Convert a plain text body into a branded, single-column HTML document with
 * inline styles (email-safe). Auto-detects "- " bullets to build list rows.
 */
export function bodyToHtml(body, company) {
  const lines = String(body || '').split(/\r?\n/);
  const blocks = [];
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx].trim();
    if (!line) { idx++; continue; }
    if (/^[-*•]\s/.test(line)) {
      const items = [];
      while (idx < lines.length && /^[-*•]\s/.test(lines[idx].trim())) {
        items.push(escapeHtml(lines[idx].trim().replace(/^[-*•]\s/, '')));
        idx++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    const para = [];
    while (idx < lines.length) {
      const l = lines[idx].trim();
      if (!l || /^[-*•]\s/.test(l)) break;
      para.push(escapeHtml(l));
      idx++;
    }
    const joined = para.join(' ');
    if (/^Best regards[,:]?/i.test(joined.trim())) {
      blocks.push({ kind: 'signature' });
      continue;
    }
    if (/^\+\d/.test(joined) && para.length === 1) continue;
    blocks.push({ kind: 'p', text: joined });
  }

  const bodyHtml = blocks.map((b) => {
    if (b.kind === 'ul') {
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px 0">
${b.items.map((it) => `<tr><td style="vertical-align:top;width:20px;padding:0 8px 8px 0"><span style="display:inline-block;width:6px;height:6px;background:${ACCENT};margin-top:8px"></span></td><td class="bullet-text" style="padding:0 0 8px 0;font-family:${BODYFONT};font-size:14px;line-height:1.6;color:${FG_SOFT}">${it}</td></tr>`).join('\n')}
</table>`;
    }
    if (b.kind === 'signature') return signatureHtml();
    return `<p class="para" style="margin:0 0 14px 0;font-family:${BODYFONT};font-size:14px;line-height:1.7;color:${FG_SOFT}">${b.text}</p>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting" content="true">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<style>
  /* Email-safe responsive overrides: target <=600px (mobile) down to 320px.
     Desktop (inline styles) unaffected. Gmail app/web + Apple Mail + Outlook
     app honour @media; inline styles guarantee a sane baseline everywhere. */
  @media screen and (max-width: 600px) {
    .outer { width: 100% !important; }
    .hero-pad { padding: 22px 20px 16px 20px !important; }
    .body-pad { padding: 20px 20px 8px 20px !important; }
    .hero-title { font-size: 27px !important; }
    .topbar-l, .topbar-r { font-size: 9px !important; letter-spacing: .12em !important; }
    .footer-l, .footer-r { font-size: 9px !important; letter-spacing: .12em !important; }
    .brush-cell { height: 3px !important; }
    .para { font-size: 14px !important; }
    .bullet-text { font-size: 14px !important; }
  }
  @media screen and (max-width: 480px) {
    td.chip { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; }
    .hero-title { font-size: 24px !important; }
    .sig-avatar { display: block !important; width: auto !important; padding: 0 0 10px 0 !important; }
    .sig-meta { display: block !important; width: 100% !important; }
    .pills-tag { font-size: 12px !important; }
  }
  @media screen and (max-width: 360px) {
    .hero-title { font-size: 22px !important; }
    .topbar-l, .topbar-r { display: block !important; text-align: left !important; line-height: 1.8 !important; }
    .footer-l, .footer-r { display: block !important; text-align: left !important; line-height: 1.8 !important; }
    .para, .bullet-text { font-size: 13px !important; }
    td.br-sep { padding: 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${INK};font-family:${BODYFONT};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div class="outer" style="box-sizing:border-box;max-width:640px;margin:0 auto;padding:20px 10px">
    <!-- TOP MONO BAR -->
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 14px;margin-bottom:12px;min-width:0">
      <span class="topbar-l" style="flex:1 1 auto;min-width:0;font-family:${MONO};font-size:10px;letter-spacing:.18em;color:${MUTE}">KALYAN (W) · MUMBAI — INDIA</span>
      <span class="topbar-r" style="flex:1 1 auto;min-width:0;text-align:right;font-family:${MONO};font-size:10px;letter-spacing:.18em;color:${MUTE}">EST. 2024 — SYSTEMS IN PRODUCTION</span>
    </div>
    ${brushStrip()}

    <!-- HERO CARD -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${INK_CARD};border:1px solid ${LINE};border-radius:14px;overflow:hidden;margin-top:14px">
      <tr>
        <td class="hero-pad" style="padding:26px 28px 18px 28px">
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:14px"><tr>
            <td class="pills-tag" style="padding:4px 12px;border-radius:999px;border:1px solid ${ACCENT}66;background:${ACCENT}12;font-family:${MONO};font-size:11px;letter-spacing:.14em;color:${CYAN}">${company ? 'APPLICATION — ' + escapeHtml(company) : 'JAYESH SINGH'}</td>
          </tr></table>
          <div class="hero-title" style="font-family:${MONO};font-size:12px;letter-spacing:.14em;color:${ACCENT_DIM}">FULL STACK ENGINEER / AI SYSTEMS BUILDER</div>
          <div class="hero-h1" style="font-family:${DISPLAY};font-size:32px;font-weight:700;line-height:1.12;color:${FG};margin-top:8px;letter-spacing:-0.3px">Engineering systems<br/>that ship.</div>
          <div class="hero-sub" style="font-family:${BODYFONT};font-size:13px;line-height:1.6;color:${MUTE};margin-top:10px">Full-stack engineering, AI systems, automation and infrastructure — built from architecture to production.</div>
          ${statChips()}
          <div style="font-family:${MONO};font-size:10px;letter-spacing:.14em;color:${MUTE};margin-top:16px">$_ THIS IS MY APPLICATION — SEE THE SYSTEM BENEFIT THE TEAM</div>
        </td>
      </tr>
    </table>

    <!-- BODY CARD -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${INK_CARD};border:1px solid ${LINE};border-radius:14px;overflow:hidden;margin-top:14px">
      <tr><td>${brushStrip()}</td></tr>
      <tr>
        <td class="body-pad" style="padding:22px 28px 6px 28px">
          ${sectionLabel('01', 'THE PITCH')}
          ${bodyHtml}
        </td>
      </tr>
    </table>

    <!-- MAJOR KEYWORDS STRIP -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;background:${INK_CARD};border:1px solid ${LINE};border-radius:14px">
      <tr>
        <td style="padding:14px 18px;text-align:center;font-family:${MONO};font-size:10px;letter-spacing:.16em;color:${MUTE};line-height:2">
          FULL-STACK ENGINEERING&nbsp;&nbsp;·&nbsp;&nbsp;AI SYSTEMS&nbsp;&nbsp;·&nbsp;&nbsp;AUTOMATION&nbsp;&nbsp;·&nbsp;&nbsp;INFRASTRUCTURE&nbsp;&nbsp;·&nbsp;&nbsp;PRODUCT SHIPPING
        </td>
      </tr>
      <tr><td style="padding:0">${brushStrip()}</td></tr>
    </table>

    <!-- FOOTER -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px">
      <tr>
        <td class="footer-l" style="font-family:${MONO};font-size:10px;letter-spacing:.16em;color:${MUTE}">OPEN TO ON-SITE &amp; HYBRID</td>
        <td class="footer-r" align="right" style="font-family:${MONO};font-size:10px;letter-spacing:.16em;color:${ACCENT_DIM}">RESUME ATTACHED &raquo;</td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

/**
 * Build the multipart/alternative fragment (text/plain + text/html).
 * The caller wraps this inside multipart/mixed and appends attachments.
 */
export function mimeAlternative(body, company) {
  const boundaryAlt = '==alt_' + Date.now() + '_' + Math.random().toString(16).slice(2) + '==';
  const textPart =
    `Content-Type: text/plain; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
    encodeQuotedPrintable(String(body || '').replace(/\n/g, '\r\n')) + '\r\n\r\n';

  const html = bodyToHtml(body, company);
  const htmlPart =
    `Content-Type: text/html; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
    encodeQuotedPrintable(html) + '\r\n\r\n';

  const alt =
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n` +
    `--${boundaryAlt}\r\n${textPart}` +
    `--${boundaryAlt}\r\n${htmlPart}` +
    `--${boundaryAlt}--\r\n`;

  return { boundaryAlt, alt, html };
}

/** Base64 payload block for a file attachment (76-char lines). */
export function attachmentPart(pdfBuffer, pdfName = 'Jayesh_Singh_CV.pdf') {
  if (!pdfBuffer) return '';
  const b64 = pdfBuffer.toString('base64');
  let lines = '';
  for (let i = 0; i < b64.length; i += 76) lines += b64.slice(i, i + 76) + '\r\n';
  return (
    `Content-Type: application/pdf\r\n` +
    `Content-Disposition: attachment; filename="${pdfName}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n${lines}\r\n`
  );
}