# Changelog

All notable changes to Cookie DevTools will be documented in this file.

## [0.6.1](https://github.com/brightbar-dev/cookie-devtools/compare/cookie-devtools-v0.6.0...cookie-devtools-v0.6.1) (2026-09-26)


### Bug Fixes

* **profiles:** profiles named __proto__, toString or constructor now save, list, load and delete like any other ([#33](https://github.com/brightbar-dev/cookie-devtools/issues/33)) ([ce27c33](https://github.com/brightbar-dev/cookie-devtools/commit/ce27c3371a7a400afeaa0bbbe57bd353f8f6cf65))

## [0.6.0](https://github.com/brightbar-dev/cookie-devtools/compare/cookie-devtools-v0.5.0...cookie-devtools-v0.6.0) (2026-09-24)


### Features

* ask for a store review once, after real use, with a separate link for problems ([#29](https://github.com/brightbar-dev/cookie-devtools/issues/29)) ([1cd804e](https://github.com/brightbar-dev/cookie-devtools/commit/1cd804ed03f338bf5abb548b0fb8c91d61b73682))

## [0.5.0](https://github.com/brightbar-dev/cookie-devtools/compare/cookie-devtools-v0.4.0...cookie-devtools-v0.5.0) (2026-09-19)


### Features

* a Cookies panel in DevTools that follows the inspected page ([#18](https://github.com/brightbar-dev/cookie-devtools/issues/18)) ([e89e52c](https://github.com/brightbar-dev/cookie-devtools/commit/e89e52c253de92b4d4be414d8ee1119c61f93ecc))
* import with preview, value inspector, sortable filterable list ([#11](https://github.com/brightbar-dev/cookie-devtools/issues/11)) ([8e2b649](https://github.com/brightbar-dev/cookie-devtools/commit/8e2b649f6d4175410ee184713d34df26145faa1d))
* keyboard control, explained empty states, AA contrast ([#13](https://github.com/brightbar-dev/cookie-devtools/issues/13)) ([2c3fbd6](https://github.com/brightbar-dev/cookie-devtools/commit/2c3fbd6ab899d1c1f26eab769631d61bb755ad2f))
* side panel, protect and block, live change feed ([#12](https://github.com/brightbar-dev/cookie-devtools/issues/12)) ([78315e0](https://github.com/brightbar-dev/cookie-devtools/commit/78315e0659cc886ceee9e5bf98f2deda050654dc))
* UI strings through _locales/en/messages.json ([#19](https://github.com/brightbar-dev/cookie-devtools/issues/19)) ([1c59cd8](https://github.com/brightbar-dev/cookie-devtools/commit/1c59cd8b39f58f322d3c4c1616b2bd01220f63be))


### Bug Fixes

* drop the retired Tailwind CSS Lookup from the cross-promotion links ([#8](https://github.com/brightbar-dev/cookie-devtools/issues/8)) ([f25b87e](https://github.com/brightbar-dev/cookie-devtools/commit/f25b87e939396d53160ff640071d2d02fac88153))
* explain withheld site access instead of an empty cookie list ([#20](https://github.com/brightbar-dev/cookie-devtools/issues/20)) ([e8afdaf](https://github.com/brightbar-dev/cookie-devtools/commit/e8afdaf5ee4e3a6556c0e9663ae93a90feaa795f))
* make cookie writes safe and faithful ([#10](https://github.com/brightbar-dev/cookie-devtools/issues/10)) ([02163f0](https://github.com/brightbar-dev/cookie-devtools/commit/02163f0b1150cdb43586a453c27eccd674f408b0))
* remove the last "no permission warnings" line from the README store copy ([#17](https://github.com/brightbar-dev/cookie-devtools/issues/17)) ([e2bde28](https://github.com/brightbar-dev/cookie-devtools/commit/e2bde28a45aa1925e1bd3638990ed0ac464ad331))
* remove the last false "no install warnings" claim from the README listing copy ([#16](https://github.com/brightbar-dev/cookie-devtools/issues/16)) ([2c200d1](https://github.com/brightbar-dev/cookie-devtools/commit/2c200d1bea28e9890a7551d32aa274cfbe5f8cfd))
* truthful install-warning claims on the listing, README and promo tiles ([#15](https://github.com/brightbar-dev/cookie-devtools/issues/15)) ([830c6f6](https://github.com/brightbar-dev/cookie-devtools/commit/830c6f6f18a41a8722ddce61fcca9e393c44491b))

## [0.4.0](https://github.com/brightbar-dev/cookie-devtools/compare/cookie-devtools-v0.3.0...cookie-devtools-v0.4.0) (2026-09-13)


### Features

* add 20-locale i18n for CWS listing optimization ([4067d08](https://github.com/brightbar-dev/cookie-devtools/commit/4067d08e5ffd6f16ebe477219e131bd32fcc016d))
* add cross-promotion links to popup ([dd6b253](https://github.com/brightbar-dev/cookie-devtools/commit/dd6b2534af37df3bbb15be6ca71469067f10a5ae))
* add large and marquee promo tiles, update small tile with new icon ([2e6f814](https://github.com/brightbar-dev/cookie-devtools/commit/2e6f814c2d3684880260ca313c0353b4498029be))
* add store/cws.json for CWS submission metadata ([08c5c03](https://github.com/brightbar-dev/cookie-devtools/commit/08c5c03bf9da5bb40769a27a5f403a7727adac06))
* replace icon with cookie design, add CWS-sized screenshots ([e8b0e5c](https://github.com/brightbar-dev/cookie-devtools/commit/e8b0e5c525d39d76cc3691abf2a1113d5b1ba75c))


### Bug Fixes

* drop the redundant `tabs` permission; README said "Coming soon" of a live listing ([334ac2e](https://github.com/brightbar-dev/cookie-devtools/commit/334ac2e12953023c5acf327237ea74fe7ab6a1cf))

## [0.3.0](https://github.com/brightbar-dev/cookie-devtools/compare/cookie-devtools-v0.2.0...cookie-devtools-v0.3.0) (2026-03-06)


### Features

* update CI for WXT, add separate release workflow ([2e3a44d](https://github.com/brightbar-dev/cookie-devtools/commit/2e3a44de30378f47b38a6254f107a0763a2d86bd))

## [0.1.0] - 2026-02-24

### Added
- Cookie CRUD: view, add, edit, delete cookies for the current site
- Visual attribute badges: Secure, HttpOnly, SameSite, Session
- Search and filter across cookie names, values, and domains
- Real-time cookie change monitor with cause tracking
- Environment profiles: save/restore named cookie snapshots
- Export to JSON, cookie file (curl/wget), curl command, Cookie header
- Dark mode with system preference auto-detection
- Options page for preferences
