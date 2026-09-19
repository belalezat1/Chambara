# Connect a phone (Windows)

From the `game` directory:

1. Run `npm run dev` and leave that terminal open.
2. In a second terminal, run `npm run tunnel`. On first use this downloads the official Cloudflare Windows x64 executable into the ignored `.tools` directory. No global installation or Cloudflare account is needed.
3. Open the printed `https://…trycloudflare.com` address on your computer. The address changes when you restart the tunnel.
4. Click **Copy controller link** in that game page and open the copied link on your phone. This includes the matching room code.
5. Tap **Enable Motion**, allow sensor access, hold the phone screen-up with its top edge toward the monitor, and tap **Recenter**.
6. Tilt to choose a guard, then swing to slash. Adjust the phone's swing threshold if needed; lower values trigger more easily.

Both terminals must stay running. Ctrl+C in the tunnel terminal stops the temporary public HTTPS link. The tunnel exposes this development game while it runs.

If Vite is using a different port, run `npm run tunnel -- -Port 5174` with that port instead. The default is 5173.

## Tunnel URL will not load / DNS error

Quick tunnels print a `*.trycloudflare.com` URL. Some school/corp DNS servers refuse those hostnames even though `cloudflared` itself connects.

On macOS, `npm run tunnel` will detect this and prompt for your password to add a **temporary** `/etc/hosts` line (removed on Ctrl+C). Approve the dialog, then open the printed HTTPS URL.

Manual alternatives:
- Set Wi‑Fi DNS to `1.1.1.1` / `8.8.8.8` (System Settings → Network → Wi‑Fi → Details → DNS), or
- Run: `sudo sh -c 'printf "%s\n" "104.16.230.132 YOUR-HOST.trycloudflare.com # chambara-trycloudflare-tunnel" >> /etc/hosts'` after resolving the IP with `dig +short YOUR-HOST.trycloudflare.com @1.1.1.1`

Cloudflare reference: https://developers.cloudflare.com/tunnel/get-started/
