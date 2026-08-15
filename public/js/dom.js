/**
 * باني عناصر صغير — بديل آمن عن innerHTML.
 *
 * Every view builds real DOM nodes instead of concatenating HTML strings.
 * Text always goes through textContent, so no value — from storage, from the
 * server, or typed by the user — can ever be parsed as markup. That is what
 * lets the Content-Security-Policy stay at `script-src 'self'` with no
 * 'unsafe-inline' anywhere.
 */

/**
 * @param {string} tag
 * @param {object} [props]  class | text | html-free attrs | on | style | data | attrs
 * @param {...(Node|string|number|false|null|undefined|Array)} children
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) {
        if (handler) node.addEventListener(event, handler);
      }
    } else if (key === 'style') {
      // Set through the CSSOM, never as a style="" attribute: CSP blocks the
      // attribute form but not this.
      for (const [prop, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (prop.startsWith('--')) node.style.setProperty(prop, String(v));
        else node.style[prop] = String(v);
      }
    } else if (key === 'data') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) node.dataset[k] = String(v);
      }
    } else if (key === 'attrs') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
      }
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

/** Renders the structured cue/verdict format: strings and { b: "..." } parts. */
export function richText(parts) {
  if (typeof parts === 'string') return [document.createTextNode(parts)];
  if (!Array.isArray(parts)) return [];
  return parts.map((part) =>
    typeof part === 'string'
      ? document.createTextNode(part)
      : el('b', { text: String(part?.b ?? '') })
  );
}

/**
 * Only ever hand an <a href> a URL we are sure is a plain web link.
 * Blocks javascript:, data: and friends even if the program data is tampered with.
 */
export function safeUrl(url) {
  try {
    const parsed = new URL(String(url), location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '#';
  } catch {
    return '#';
  }
}

export const $ = (selector, root = document) => root.querySelector(selector);
