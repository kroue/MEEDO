import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Builds the console into a Cloudflare Worker.
 *
 * Cloudflare cannot run `next start`, and the console has pages it renders per
 * request — an account, a bill, a printed receipt — so a plain static upload
 * would leave those as 404s. This adapter turns the Next build into a Worker
 * that serves them, with the static files served straight from Cloudflare's
 * edge alongside it.
 *
 * No incremental cache is configured: every page here is either static or
 * rendered fresh from the database on the client, so there is nothing whose
 * staleness would be an improvement over asking.
 */
export default defineCloudflareConfig();
