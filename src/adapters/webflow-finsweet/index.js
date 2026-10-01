// Adapter for Webflow CMS agendas filtered with Finsweet Attributes (fs-list-field="...").
// An adapter is DATA: CSS selectors that both engines (DOM and HTMLRewriter) execute.
// Selectors under `fields` / `groups` are relative to the item (descendant selectors only,
// limited to the subset HTMLRewriter supports: tag, .class, [attr], [attr="v"], :not(), :first-child).

// Webflow hides conditional blocks with .w-condition-invisible; only the visible card box holds data.
const BOX = '.agenda-v2_card_box:not(.w-condition-invisible)';

export default {
  name: 'webflow-finsweet',
  item: '.agenda-v2_item',
  // Day-header cards ("Day 1, Wednesday...") are list items too; skip them.
  skip: '.agenda-v2_card_box.is-day-item:not(.w-condition-invisible)',
  fields: {
    day: '[fs-list-field="day"]',
    type: `${BOX} .agenda-v2_card_event-type`,
    range: `${BOX} .agenda-v2_card_meta-item:first-child`,
    duration: `${BOX} .agenda-v2_card_meta-item.is-time`,
    stage: `${BOX} [fs-list-field="stage"]`,
    title: `${BOX} .agenda-v2_card_title`,
  },
  groups: {
    speakers: {
      item: `${BOX} .agenda-v2_card_speakers_item`,
      fields: {
        firstname: '[fs-list-field="firstname"]',
        lastname: '[fs-list-field="lastname"]',
        job: '[fs-list-field="job"]',
        company: '[fs-list-field="company"]',
        tag: '.agenda-v2_speakers_tag',
      },
    },
  },
  /** URLs to fetch for an event: Webflow paginates CMS lists with ?<listId>_page=N. */
  pageUrl(event, n) {
    const u = new URL(event.agendaUrl);
    if (event.pagination?.param) u.searchParams.set(event.pagination.param, String(n));
    return u.toString();
  },
  /** Is there another page after this HTML? (string check works in every runtime) */
  hasNextPage(html) {
    return /class="[^"]*w-pagination-next/.test(html);
  },
};
