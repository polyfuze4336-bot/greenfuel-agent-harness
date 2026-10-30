# Deck assets

A photograph or an official Azure icon enters the generated deck only through `manifest.json`. An entry needs:

* `id`: the slot it fills. `hero` is the title-slide photograph; `azure-<name>` are the topology icons (`entra`, `containerapps`, `policy`, `servicebus`, `foundry`, `postgres`, `blob`, `keyvault`, `monitor`, `ledger`, `acr`);
* `kind`: `photo` or `azure-icon`;
* `file`: a path inside this folder;
* `title`, `creator`, `source`, `licence` (and `licenceUrl` if there is one);
* `sha256` of the file, so a file changed after approval is not used;
* `approved: true`, `approvedBy` and `approvedAt`: a named person's approval.

An asset that fails any of these is not used; the deck falls back to its own vector artwork or a labelled tile, and `generation.json` records that. **The manifest is empty**: no photograph has been licensed or approved, and nothing here was generated or downloaded. Do not add an image whose licence you cannot show.
