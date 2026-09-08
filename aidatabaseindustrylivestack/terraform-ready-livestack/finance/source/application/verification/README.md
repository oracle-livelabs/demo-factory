## Import v1 Verification Assets

- **Bundled demo dataset**
  - `verification/demo-dataset/{required,optional}` is the committed restore-demo source used by `/api/import/restore-demo/validate` and `/api/import/restore-demo`.
  - Regenerate it from a fully seeded local Oracle stack with `node verification/export-demo-dataset.js` from the running `app` container, or any shell that already has the app's Oracle env vars and dependencies loaded.

- **Fixture layout**
  - `verification/fixtures/required` mirrors the mandatory tables routed with every bundle (`brands`, `products`, `fulfillment_centers`, `customers`, `influencers`, `social_posts`, `post_product_mentions`, `inventory`, `orders`, `order_items`). Each CSV uses the exact header order emitted by `backend/lib/importCatalog.js`.
  - `verification/fixtures/optional` exercises the fallback inputs that the importer can regenerate (`shipments`, `demand_regions`, `demand_forecasts`, `influencer_connections`, `brand_influencer_links`). Omit any of these to let the service build a reasonable substitute.
  - The template archive also includes `manifest.json` and the README from this directory so the validator can confirm the requested version before any destructive work begins.

- **Usage**
  1. Zip the required CSVs plus whichever optional sheets you want to control into the provided template (the backend also accepts base64-encoded archives via `archiveBase64`).
  2. POST the bundle to `/api/import/validate` (multipart form field named `file`) to run a full dry run; the JSON response surfaces `valid`, `warnings`, and `errors`.
  3. When the dry run succeeds, POST the same bundle to `/api/import/upload` and watch `/api/import/status/:jobId` for hydration progress.

- **Checklist**
  - **Required tables present:** Every required CSV must exist, especially `inventory.csv`; missing files are rejected before any SQL executes.
  - **Header validation:** Renaming `brand_slug` to `brandslug` or reordering columns triggers the column expectation error embedded in `backend/lib/importCatalog.js`.
  - **Foreign keys:** `orders.customer_id`, `order_items.product_id`, `inventory.center_id`, and other reference columns must resolve to source IDs in the uploaded CSVs; broken references are flagged pre-import.
  - **Optional omission:** Drop `shipments.csv` or `demand_regions.csv` from the bundle, rerun validation, and verify the preview still reports `valid: true` while warning that it will regenerate the missing data.

- **Derived and regenerated data**
  - Spatial point columns (`fulfillment_centers.location`, `customers.location`) are recalculated from the latitude/longitude pairs immediately after the base load.
  - `fulfillment_zones` are rebuilt from the active center geometries even when `demand_regions.csv` is absent.
  - Missing graph/fallback inputs (`shipments`, `demand_regions`, `demand_forecasts`, `influencer_connections`, `brand_influencer_links`) are synthesized so dashboard views remain populated.
  - `product_embeddings`, `signal_embeddings`, and `semantic_matches` run after the base import, using the `ALL_MINILM_L12_V2` vector model; if the model is unavailable, the import finishes but warns about the skipped vector refresh.
