# Agent Workbench - Brand kit v1.0

Visual identity based on the approved robot symbol in orange and purple.

## Rights

The name, robot, logos, icons and original artwork are reserved to André Nunes. This kit is an official reference and does not authorize reuse, republication or redistribution. See the [brand license](LICENSE). Third-party fonts retain their original licenses.

## Usage

- Primary symbol: `01-logos/svg/awb-symbol-orange.svg`.
- Lockup on dark backgrounds: `awb-lockup-light.svg`.
- Lockup on light backgrounds: `awb-lockup-dark.svg`.
- SVG and PDF are vector formats. Lettering in SVG lockups is converted to outlines.
- Logo PNGs are transparent. App icons have their own background.
- Numbers in PNG filenames indicate their size in pixels.
- Follow the clear space and minimum sizes in the guide.

## Colors

Primary orange: #FF791F. Purple background: #21182F.
Ready-to-use CSS and JSON tokens, plus a GIMP palette.
Values are RGB for screens. For print, use a color conversion and approve a proof.

## Fonts

Open Sans Regular, Semibold and Bold; Source Code Pro Regular.
Third-party font files and their original licenses are included in `04-fonts`.

## Generation

The symbol was rebuilt as vector geometry to refine the cutouts and colors of the visual proposal. The app does not depend on these export scripts.

The script in `06-source/build-brand-kit.py` uses Python, reportlab, Pillow, fonttools and Poppler (`pdftocairo`). To rebuild an extracted ZIP, run `python3 06-source/build-brand-kit.py --language en` from the kit directory with these tools available. In the repository, run `python3 scripts/build-brand-kit.py --language en`. Files are ready for use in official Agent Workbench distributions without running the script. This does not grant third parties permission to use the brand.

The brand board and interface example demonstrate the identity. They are not screenshots of a real session.
