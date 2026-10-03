const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "../node_modules/next/dist/server/route-matchers/locale-route-matcher.js"
);

const content = `"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "LocaleRouteMatcher", {
    enumerable: true,
    get: function() {
        return LocaleRouteMatcher;
    }
});
const _routematcher = require("./route-matcher");
class LocaleRouteMatcher extends _routematcher.RouteMatcher {
    get identity() {
        return \`\${this.definition.pathname}?__nextLocale=\${this.definition.i18n?.locale}\`;
    }
    match(pathname, options) {
        const result = this.test(pathname, options);
        if (!result) return null;
        return {
            definition: this.definition,
            params: result.params,
            detectedLocale: options?.i18n?.detectedLocale ?? this.definition.i18n?.locale
        };
    }
    test(pathname, options) {
        if (this.definition.i18n && options?.i18n) {
            if (this.definition.i18n.locale && options.i18n.detectedLocale && this.definition.i18n.locale !== options.i18n.detectedLocale) {
                return null;
            }
            return super.test(options.i18n.pathname);
        }
        return super.test(pathname);
    }
}
`;

try {
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (stat.size === 0) {
      fs.writeFileSync(target, content, "utf8");
      console.log("[fix-next-locale-matcher] Restored 0-byte locale-route-matcher.js");
    }
  }
} catch (e) {
  // Silent fail if node_modules not yet installed
}
