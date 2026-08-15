/**
 * Waitlist welcome email — matches hatchly-marketing-2026 (pink hero, Fredoka/Nunito, cozy copy).
 * Table + inline styles for Outlook / Gmail / Apple Mail.
 *
 * Halloween set art URLs are live CDN assets from gameitemdefs (items3 seed).
 */

const HALLOWEEN_SET_PREVIEW: ReadonlyArray<{ label: string; imageUrl: string }> = [
  {
    label: 'Ghost Family',
    imageUrl:
      'https://images.hatchly.me/game-items/decoration_ghost_family/d2709e53-74a3-42d6-b39d-43d0fb3cbd6b.png',
  },
  {
    label: 'Witch Cottage',
    imageUrl:
      'https://images.hatchly.me/game-items/building_witch_cottage/fc0f93d1-8af4-4df7-9e72-32000b7e1d41.png',
  },
  {
    label: 'Creepy Scarecrow',
    imageUrl:
      'https://images.hatchly.me/game-items/decoration_creepy_scarecrow/3aec7b94-a967-41a5-b9c6-bd4c797c1842.png',
  },
  {
    label: 'Haunted Clock Tower',
    imageUrl:
      'https://images.hatchly.me/game-items/building_haunted_clock_tower/0314fa40-f15b-44b4-acc1-57ed746928bc.png',
  },
  {
    label: 'Bone Throne',
    imageUrl:
      'https://images.hatchly.me/game-items/scenery_bone_throne/865c13de-5655-46bc-bd1e-d41751aaa4aa.png',
  },
  {
    label: 'Ghost Lantern',
    imageUrl:
      'https://images.hatchly.me/game-items/decoration_ghost_lantern/66e89180-21b9-4fb5-81a1-f735696f24b3.png',
  },
];

function halloweenItemCell(item: { label: string; imageUrl: string }): string {
  return `<td width="33.33%" align="center" valign="top" style="padding:8px 6px;font-family:'Nunito','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;border-radius:16px;">
    <tr>
      <td align="center" style="padding:12px 8px 6px;">
        <img
          src="${item.imageUrl}"
          alt="${item.label}"
          width="88"
          height="88"
          style="display:block;width:88px;height:88px;object-fit:contain;border:0;"
        />
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:0 6px 12px;font-family:'Nunito','Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;line-height:1.3;color:#3a2448;">
        ${item.label}
      </td>
    </tr>
  </table>
</td>`;
}

function halloweenSetGridHtml(): string {
  const rows: string[] = [];
  for (let i = 0; i < HALLOWEEN_SET_PREVIEW.length; i += 3) {
    const slice = HALLOWEEN_SET_PREVIEW.slice(i, i + 3);
    rows.push(
      `<tr>${slice.map(halloweenItemCell).join('')}</tr>`,
    );
  }
  return rows.join('');
}

export function waitlistWelcomeHtml(): string {
  const year = new Date().getFullYear();
  const fontDisplay = "'Fredoka', 'Trebuchet MS', 'Segoe UI', sans-serif";
  const fontBody = "'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>You're on the Hatchly waitlist</title>
  <!--[if !mso]><!-->
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <!--<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#ffd0e4;font-family:${fontBody};color:#3a2448;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffd0e4;">
    You're in! Early flock gets exclusive Halloween set pieces when beta opens September 21, 2026.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffd0e4;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#fff4e8;border-radius:28px;overflow:hidden;box-shadow:0 10px 28px rgba(58,36,72,0.10);">

          <!-- Pink hero band (matches site status-bar / hero top) -->
          <tr>
            <td align="center" style="background:linear-gradient(180deg,#ffd0e4 0%,#ffb3d0 55%,#fff4e8 100%);padding:36px 28px 20px;">
              <p style="margin:0;font-family:${fontDisplay};font-size:28px;font-weight:700;letter-spacing:0.01em;color:#3a2448;line-height:1.2;">
                Hatchly
              </p>
              <p style="margin:8px 0 0;font-family:${fontDisplay};font-size:18px;font-weight:600;color:#e8457a;line-height:1.35;">
                Stay healthy. Gain a cuddle buddy.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:8px 24px 0;background-color:#fff4e8;">
              <img
                src="https://hatchly.me/og-image.png"
                alt="Wisp, Hatchly's sleepy AI pet companion"
                width="472"
                style="display:block;width:100%;max-width:472px;height:auto;border:0;border-radius:20px;"
              />
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px 8px;background-color:#fff4e8;text-align:center;">
              <p style="margin:0 0 10px;font-family:${fontDisplay};font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#e8457a;">
                September 21, 2026
              </p>
              <h1 style="margin:0;font-family:${fontDisplay};font-size:26px;font-weight:700;line-height:1.25;color:#3a2448;">
                You're in — spot saved
              </h1>
              <p style="margin:14px 0 0;font-family:${fontBody};font-size:16px;font-weight:600;line-height:1.65;color:#6a4d7a;">
                We'll invite you when Hatchly unlocks. Early flock gets first dibs on premium trial perks — plus exclusive Halloween set pieces for your farm.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 8px;background-color:#fff4e8;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:20px;box-shadow:0 10px 28px rgba(58,36,72,0.08);">
                <tr>
                  <td style="padding:22px 24px;font-family:${fontBody};font-size:15px;font-weight:600;line-height:1.7;color:#3a2448;">
                    <p style="margin:0 0 12px;font-family:${fontDisplay};font-size:18px;font-weight:700;color:#e8457a;">
                      What you get as early flock
                    </p>
                    <p style="margin:0 0 10px;border-left:4px solid #ff6b9d;padding-left:12px;">
                      First-wave beta invite before the wider hatch
                    </p>
                    <p style="margin:0 0 10px;border-left:4px solid #ff9a4a;padding-left:12px;">
                      Exclusive Halloween set pieces (custom waitlist items)
                    </p>
                    <p style="margin:0 0 10px;border-left:4px solid #7ee0c8;padding-left:12px;">
                      First dibs on premium trial perks
                    </p>
                    <p style="margin:0;border-left:4px solid #9ed8ff;padding-left:12px;">
                      A cozy seat in the Hatchly Discord flock
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Halloween set preview (live game-item art) -->
          <tr>
            <td style="padding:22px 20px 8px;background-color:#fff4e8;text-align:center;">
              <p style="margin:0 0 6px;font-family:${fontDisplay};font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#e8457a;">
                A peek at the Halloween set
              </p>
              <p style="margin:0 0 14px;font-family:${fontBody};font-size:14px;font-weight:600;line-height:1.5;color:#6a4d7a;">
                Waitlisters get custom items from this cozy spooky collection — a few favorites below.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(180deg,#ffe8d6 0%,#ffd0e4 100%);border-radius:20px;">
                <tr>
                  <td style="padding:10px 6px 14px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${halloweenSetGridHtml()}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:26px 32px 10px;background-color:#fff4e8;">
              <!-- Pink pill CTA (solid fallback for Outlook) -->
              <a
                href="https://discord.gg/ytvfBajAhh"
                style="display:inline-block;background-color:#ff6b9d;background-image:linear-gradient(160deg,#ff8fb8 0%,#ff6b9d 45%,#e8457a 100%);color:#ffffff;text-decoration:none;font-family:${fontDisplay};font-size:16px;font-weight:700;letter-spacing:0.02em;padding:14px 28px;border-radius:999px;box-shadow:0 4px 0 #c9366a,0 12px 28px rgba(232,69,122,0.35);text-shadow:0 1px 0 rgba(120,20,60,0.25);"
              >
                Join the cozy Discord
              </a>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:8px 32px 24px;background-color:#fff4e8;">
              <a
                href="https://hatchly.me/"
                style="display:inline-block;font-family:${fontBody};font-size:14px;font-weight:700;color:#e8457a;text-decoration:underline;"
              >
                Peek the site again →
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 12px;background-color:#fff4e8;font-family:${fontBody};font-size:14px;font-weight:600;line-height:1.6;color:#6a4d7a;text-align:center;">
              No spam — just hatch-day news and your invite.
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 28px;background-color:#fff4e8;border-top:1px solid rgba(232,69,122,0.15);font-family:${fontBody};font-size:12px;line-height:1.55;color:#6a4d7a;text-align:center;">
              <p style="margin:0 0 8px;">
                © ${year} Hatchly. Stay healthy. Gain a cuddle buddy.
              </p>
              <p style="margin:0;">
                <a href="https://hatchly.me/privacy" style="color:#e8457a;text-decoration:underline;">Privacy</a>
                &nbsp;·&nbsp;
                <a href="https://hatchly.me/unsubscribe" style="color:#6a4d7a;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const WAITLIST_WELCOME_SUBJECT =
  "You're in! Hatchly beta opens September 21";
