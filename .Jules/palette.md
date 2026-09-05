## 2026-09-02 - Focus indicators for keyboard accessibility
**Learning:** Found that the app lacks global focus indicators for its custom control elements (.btn, .control-select, .control-file-btn, .control-checkbox, .volume-slider), which significantly degrades keyboard navigation and accessibility.
**Action:** Added targeted `:focus-visible` and `:focus-within` styles with an offset outline to provide clear visual feedback while navigating via keyboard, preserving the default mouse interactions.

## 2026-09-05 - Add Confirmation Dialogs for Destructive Actions
**Learning:** Found inconsistent confirmation patterns for destructive actions in the app. Bulk delete had a confirmation, but single tape delete and slot state delete did not.
**Action:** Always verify that all destructive actions (single and bulk) have consistent confirmation prompts to prevent accidental data loss.
