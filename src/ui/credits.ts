// About / Credits screen — REQUIRED deliverable. Freedoom is BSD-3-Clause, whose
// binary-redistribution clause requires reproducing the copyright notice, the list of
// conditions, and the AS-IS warranty disclaimer in the shipped product (assets.md §2).
// This screen satisfies that obligation; drawCredits is implemented so it renders for
// real. Verbatim text from docs/research/assets.md §2 (COPYING.adoc).

export const FREEDOOM_LICENSE_TEXT = `Copyright © 2001-2024
Contributors to the Freedoom project.  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.
  * Neither the name of the Freedoom project nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

For a list of contributors to the Freedoom project, see the file CREDITS.`;

export const CREDITS_HEADER = [
  'DOOM-TS',
  'A Canvas 2D raycaster built with TypeScript + Vite.',
  '',
  'Art & audio: Freedoom 0.13.0 (freedoom2.wad) — https://freedoom.github.io',
  'Freedoom is licensed under the modified (3-clause) BSD license.',
  'This product is not endorsed by or affiliated with the Freedoom project.',
  '',
];

/** Render the About/Credits screen (header + verbatim Freedoom license). */
export function drawCredits(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  let y = 6;
  ctx.fillStyle = '#c9b070';
  ctx.font = '7px monospace';
  for (const line of CREDITS_HEADER) {
    ctx.fillText(line, 8, y);
    y += 8;
  }

  ctx.fillStyle = '#9a9a9a';
  ctx.font = '5px monospace';
  for (const line of FREEDOOM_LICENSE_TEXT.split('\n')) {
    ctx.fillText(line, 8, y);
    y += 6;
  }

  ctx.fillStyle = '#666';
  ctx.font = '6px monospace';
  ctx.fillText('[Esc] back', 8, height - 10);
}
