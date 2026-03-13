/**
 * AI Service
 * Calls Firebase Cloud Functions backed by GPT-4.1 for AI-powered features
 */

import { functions, httpsCallable } from "../config/firebase.js";
import { getCurrentLanguage } from "../utils/i18n.js";

/**
 * Summarize a list of notifications using GPT-4.1.
 * @param {Array} notifications - Array of notification objects
 * @returns {Promise<string>} - The AI-generated summary
 */
export async function summarizeNotifications(notifications) {
  const summarize = httpsCallable(functions, "summarizeNotifications");

  const language = getCurrentLanguage();

  const payload = notifications.map((n) => ({
    appName: n.appName || n.packageName || "",
    title: n.title || "",
    text: n.text || n.body || "",
  }));

  const result = await summarize({ notifications: payload, language });
  return result.data.summary;
}
