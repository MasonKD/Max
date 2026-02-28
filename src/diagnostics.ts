import type { Page } from "playwright";
import { extractGoalsOverview, normalizeWhitespace } from "./extractors.js";
import { matchKnownRoute } from "./navigation.js";
import type { KnownRouteId } from "./catalog.js";
import type { AuthState } from "./types.js";

export async function readRouteSnapshotDiagnostic(page: Page, auth?: AuthState): Promise<{
  url: string;
  auth?: AuthState;
  headingCandidates: string[];
  buttonTexts: string[];
  inputPlaceholders: string[];
  snippet: string;
}> {
  const result = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    return {
      headingCandidates: Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
        .map((el) => normalize(el.textContent || ""))
        .filter(Boolean)
        .slice(0, 20),
      buttonTexts: Array.from(document.querySelectorAll("button,[role='button'],a"))
        .map((el) => normalize(el.textContent || ""))
        .filter(Boolean)
        .slice(0, 30),
      inputPlaceholders: Array.from(document.querySelectorAll("input,textarea"))
        .map((el) => ("placeholder" in el ? String(el.placeholder || "").trim() : ""))
        .filter(Boolean)
        .slice(0, 20),
      snippet: normalize(document.body.innerText || "").slice(0, 900)
    };
  });

  return { url: page.url(), auth, ...result };
}

export async function readPageSectionsDiagnostic(page: Page): Promise<{
  url: string;
  routeId?: KnownRouteId;
  title?: string;
  headings: string[];
  paragraphs: string[];
  formLabels: string[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  snippet: string;
}> {
  const result = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    return {
      title: document.title || "",
      headings: Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
        .map((el) => normalize(el.textContent || ""))
        .filter(Boolean)
        .slice(0, 30),
      paragraphs: Array.from(document.querySelectorAll("p, li"))
        .map((el) => normalize(el.textContent || ""))
        .filter((text) => text.length >= 20)
        .slice(0, 40),
      formLabels: Array.from(document.querySelectorAll("label, legend"))
        .map((el) => normalize(el.textContent || ""))
        .filter(Boolean)
        .slice(0, 30),
      buttons: Array.from(document.querySelectorAll("button, [role='button']"))
        .map((el) => normalize(el.textContent || ""))
        .filter(Boolean)
        .slice(0, 30),
      links: Array.from(document.querySelectorAll("a[href]"))
        .map((el) => ({ text: normalize(el.textContent || ""), href: (el as HTMLAnchorElement).href || "" }))
        .filter((item) => item.href)
        .slice(0, 40),
      snippet: normalize(document.body.innerText || "").slice(0, 1200)
    };
  });

  return {
    url: page.url(),
    routeId: matchKnownRoute(page.url()),
    title: result.title || undefined,
    headings: result.headings,
    paragraphs: result.paragraphs,
    formLabels: result.formLabels,
    buttons: result.buttons,
    links: result.links,
    snippet: result.snippet
  };
}

export async function discoverLinksDiagnostic(page: Page): Promise<{
  url: string;
  routeId?: KnownRouteId;
  links: Array<{ text: string; href: string; routeId?: KnownRouteId }>;
}> {
  const links = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("a[href]"))
      .map((el) => ({ text: normalize(el.textContent || ""), href: (el as HTMLAnchorElement).href || "" }))
      .filter((item) => item.href);
  });

  return {
    url: page.url(),
    routeId: matchKnownRoute(page.url()),
    links: links.map((link) => ({ ...link, routeId: matchKnownRoute(link.href) }))
  };
}

export async function readTaskPanelSnapshotDiagnostic(
  page: Page,
  taskPanelText?: string,
  taskPanelVisible = false
): Promise<{
  url: string;
  taskPanelVisible: boolean;
  taskPanelText?: string;
  nearbyTexts: string[];
  nearbyHtml: string[];
  snippet: string;
}> {
  const result = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const candidates = Array.from(document.querySelectorAll("body *")).filter((el) =>
      /TASKS|Add new task|Use the task suggestion tool|How will you accomplish|Select Tasks/i.test(
        normalize((el as HTMLElement).innerText || el.textContent || "")
      )
    );
    return {
      nearbyTexts: candidates
        .slice(0, 20)
        .map((el) => normalize((el as HTMLElement).innerText || el.textContent || ""))
        .filter(Boolean),
      nearbyHtml: candidates.slice(0, 10).map((el) => (el as HTMLElement).outerHTML.slice(0, 600)),
      snippet: normalize(document.body.innerText || "").slice(0, 1200)
    };
  });

  return {
    url: page.url(),
    taskPanelVisible,
    taskPanelText,
    nearbyTexts: result.nearbyTexts,
    nearbyHtml: result.nearbyHtml,
    snippet: result.snippet
  };
}

export async function summarizeGoalsPage(page: Page): Promise<ReturnType<typeof extractGoalsOverview>> {
  const text = await page.locator("body").innerText().catch(() => "");
  return extractGoalsOverview(text);
}

export async function readBodySnippet(page: Page, length = 500): Promise<string> {
  const text = await page.locator("body").innerText().catch(() => "");
  return normalizeWhitespace(text).slice(0, length);
}
