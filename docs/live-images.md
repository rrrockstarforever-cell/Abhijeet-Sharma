# Images in questions

Pulse Med ships **no image library**. Every picture on an image-based question is fetched
from the internet while the questions are generated.

## Sources

| Source | What it provides | Licence filter |
| --- | --- | --- |
| **Wikimedia Commons** (includes CDC Public Health Image Library material) | Clinical photos, ECGs, radiographs, histology, fundus images | CC0 and public domain only |
| **Open-i (NLM / PubMed Central)** | Open-access figures from the medical literature | CC0 and public domain only |

Each source item's license metadata must explicitly identify CC0 or Public Domain. CC BY/SA, NC/ND,
unknown, and contradictory license metadata are rejected. Existing bank rows are checked again when
loaded, and source/license provenance stays with every accepted image. Identifiable-patient privacy
and consent rights are separate from copyright and still need to be respected.

Images are proxied through `/api/images/proxy` and cached in the app data directory, so the page never hotlinks the
source and the picture still opens offline after the first fetch. Author, licence and a
**Source ↗** link travel with every image.

## How an image reaches a question

1. The generator is asked to mark items where a real figure is expected (there is **no fixed
   quota**) and to give each one a `figureModality` and a specific `figureQuery`.
2. The app asks the local server (`/api/images/search`) which queries Commons and Open-i.
3. A result is used only when its title/caption has strong whole-token overlap with the requested finding; weak metadata matches are omitted.
4. **No repeats:** every picture is used at most once per module. If nothing suitable and
   unused is found, the item stays text-only.
5. The Practice Builder switch **Include image-based questions** turns the lookup off
   entirely (offline use), and **Settings → Image Sources for Questions** shows the same
   switch plus the reference-only atlases.

## Reference-only atlases (never scraped)

Radiopaedia, DermNet, RSNA Case Collection, MedPix, Columbia Ophthalmology Atlas and LITFL
are copyrighted or personal-use only. They are listed as links in Settings so a case can be
opened on the publisher's site.
