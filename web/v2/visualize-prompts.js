// The instruction sent with a 3D massing snapshot to Generate model.
//
// One prompt goes out per image. The built-in text is what the server uses
// when the client sends none. The examples are complete replacements: each
// one restates how to read the coloured model, then asks for a finish that
// matches a house you would actually draw.

export const MAX_VISUALIZE_PROMPT = 4000;

export const VISUALIZE_PROMPT = `Transform the provided architectural drawing into a photorealistic architectural visualization.

IMPORTANT: Treat the uploaded drawing as the authoritative source for the building design. Preserve the architecture exactly as shown.

Preserve:
- Building footprint and overall proportions
- Number of floors
- Roof shape, roof pitch and roof structure
- Position, size and proportions of all windows and doors
- Wall positions and building volumes
- Porches, balconies, verandas, patios and other architectural elements
- Garage position and doors
- Steps, columns, walls and other structural features
- Relative position and proportions of all visible architectural elements

Do NOT redesign the building, add floors, remove rooms, move windows or doors, change the roof design, or introduce architectural features that are not present in the drawing.

Convert the drawing into a realistic finished building suitable for presentation to an architectural client.

Use:
- Realistic architectural materials
- Natural plaster, brick, concrete, timber, glass and metal where appropriate
- Physically realistic lighting and shadows
- Realistic reflections in windows
- Realistic landscaping appropriate to the building
- Natural-looking grass, plants, trees and paving
- High-quality realistic textures
- Professional architectural photography

Camera:
Create an attractive three-quarter exterior perspective showing the front and side of the building. Use a realistic eye-level architectural photography viewpoint with natural perspective and no extreme wide-angle distortion.

Lighting:
Use warm late-afternoon natural sunlight with realistic shadows and highlights. The building should be well illuminated and clearly visible.

Style:
Photorealistic architectural visualization, high-end architectural photography, realistic materials, realistic scale, realistic lighting, professional presentation quality.

The final image should look like a photograph of the completed building rather than a computer-generated sketch.

Do not include people unless they are specifically present in the source drawing.
Do not add text, dimensions, annotations, labels, watermarks or logos.`;

const MASSING = `The uploaded image is a coloured 3D massing model, not a sketch, a floor plan, or a photograph. It is the design. Match it.

Read the colours as the building:
- Grey-brown volumes are existing walls and floors.
- Rust-orange volumes are proposed walls and floors.
- Blue-grey planes are roofs. Existing and proposed roofs are a similar blue. Tell a new roof by the rust walls under it, not by inventing a different roof colour.
- A step between two roof plates is a real change in height. Keep it.
- Openings in a wall are windows and doors. Keep every one, in the same place and at the same size. Blue-tinted openings are glass. Brown openings are doors.
- Thin coloured lines are pipes and cables. Do not turn them into architecture.
- Blank background is sky and ground, not a missing wing.

Preserve the footprint, the number of storeys, the plate heights, the roof shape and the roof pitch. Do not add floors, rooms, bays, gables, chimneys, balconies, verandas or wings that are not in the model. Do not move a window or a door.

No people. No text, dimensions, labels, watermarks or logos.`;

function example(id, label, note, finish) {
  return { id, label, note, prompt: `${MASSING}\n\n${finish}` };
}

export const VISUALIZE_BUILTIN = {
  id: "builtin",
  label: "Built-in",
  note: "What Generate sends until you choose another. It calls the snapshot a line drawing, so the picture often redesigns the house.",
  prompt: VISUALIZE_PROMPT,
};

export const VISUALIZE_EXAMPLES = [
  example(
    "plaster-tile",
    "Plaster and tile",
    "The usual house: painted plaster, concrete roof tiles, a plain garden. Start here when the picture should look like the model.",
    `Finish it as that house, completed.
Walls: smooth painted plaster, warm off-white. A low face-brick plinth is enough masonry. Do not turn the whole house into brick or stone.
Roof: concrete tiles, terracotta, with a fascia and gutters. Keep the pitch in the model. Do not switch a pitched roof to standing-seam metal, and do not steepen a low roof into tiles of a different pitch.
Windows and doors: clear glass in simple aluminium frames, at the size shown.
Setting: a lawn, a short path to the front door, one small tree. No pool, no courtyard, no resort planting.
Camera: eye level, three-quarter view of the front and one side, soft overcast daylight, natural perspective, no wide-angle stretch.
A photograph of this house. Not a luxury villa, and not a different design.`,
  ),
  example(
    "face-brick",
    "Face brick",
    "Face-brick walls and a tiled roof, when the house is meant to read as masonry.",
    `Finish the walls as face brick, mid red-brown, with visible mortar joints. Existing and proposed walls are the same brick. The new work is cleaner, not a different material.
Roof: concrete tiles, charcoal, with a fascia and gutters, at the pitch shown.
Openings stay clear glass in dark frames, at the size shown.
Setting: a lawn and a paved path. No pool.
Camera: eye level, three-quarter view, overcast daylight, no wide-angle stretch.
A photograph of this house, not a show home.`,
  ),
  example(
    "extension",
    "Existing and extension",
    "Grey volumes stay an older house. Rust volumes are the new work, in fresh plaster, under a matching roof.",
    `The grey-brown volumes are the house already there: weathered painted plaster, an established concrete-tile roof, ordinary signs of age.
The rust-orange volumes are the extension: fresh smooth plaster close to the old wall colour, and new concrete tiles of the same profile as the existing roof. Blue-grey roof planes stay roofs.
The line where new meets old is the line in the model, including any step in plate height. Do not redesign the old house, and do not hide the extension.
Camera: daylight, eye level, three-quarter view. A lawn and the existing path.
A photograph that shows what is being added.`,
  ),
  example(
    "sheet-roof",
    "Plaster and sheet roof",
    "Painted plaster and corrugated metal, for a simple or low-pitched roof.",
    `Walls: smooth painted plaster, off-white.
Roof: corrugated metal sheeting, zinc grey, with simple gutters. Keep the pitch shown. Do not steepen it into tiles, and do not turn it into standing seam.
Windows: clear glass, modest frames, at the size shown.
Setting: a small lawn and a gravel drive. No barn cladding, no warehouse doors, no industrial yard.
Camera: bright daylight, eye level, three-quarter view.
An ordinary completed house.`,
  ),
  example(
    "site-photo",
    "Bare site photo",
    "Flat light and an empty stand, so the form is easy to check against the model.",
    `Photograph it on a bare stand, before any garden.
Walls: unpainted plaster, light grey. Roof: concrete tiles, no feature cladding, at the pitch shown.
Ground: bare soil and a little dry grass. No planting, pool, furniture, car or paving pattern.
Light: flat overcast, no dramatic sky. Eye level, three-quarter view, no wide-angle stretch.
The point is to check the form. Do not improve the architecture.`,
  ),
  example(
    "presentation",
    "Client presentation",
    "The same building, with warmer light and a tidy garden, for a meeting.",
    `A presentation photograph for a client meeting. Same building as the model.
Walls in natural plaster, face brick only on a plinth. A timber front door if the model shows a door. Clear glass.
Warm late-afternoon sun, soft shadows, the building fully lit.
A tidy lawn, a few shrubs, a simple path. No people, no pool.
Eye level, three-quarter view of the front and one side, realistic scale, no wide-angle stretch.
Attractive, and still this design.`,
  ),
];

export function visualizePromptId(text) {
  const value = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!value || value === VISUALIZE_PROMPT.trim()) return "builtin";
  const hit = VISUALIZE_EXAMPLES.find((item) => item.prompt.trim() === value);
  return hit ? hit.id : "custom";
}

/**
 * Names the extra massing views so the photograph stays on the first image.
 * `roles` is the order after that first image: "opposite", "roof", or both.
 * A single image is unchanged.
 */
export function withReferenceImages(prompt, roles) {
  const extra = (Array.isArray(roles) ? roles : []).filter((role) => role === "opposite" || role === "roof");
  if (!extra.length) return prompt;
  const sentences = ["The first image is the photograph to match. Keep its camera and the faces it shows."];
  extra.forEach((role, index) => {
    const which = index === 0 ? "second" : "third";
    sentences.push(role === "opposite"
      ? `The ${which} image is the opposite side of the same building. Use it only for walls and roof the first image hides. Do not turn the photograph around to it.`
      : `The ${which} image is a higher view from the same side, for the roof plan, the ridges and any step between plates. Do not switch to that camera.`);
  });
  sentences.push("Do not average the images into a new angle or a new design.");
  return `${String(prompt).trim()}\n\n${sentences.join(" ")}`;
}

export function resolveVisualizePrompt(input) {
  if (input == null || input === "") return VISUALIZE_PROMPT;
  if (typeof input !== "string") {
    const error = new Error("The prompt must be text");
    error.status = 400;
    throw error;
  }
  const prompt = input.replace(/\r\n/g, "\n").trim();
  if (!prompt) return VISUALIZE_PROMPT;
  if (prompt.length > MAX_VISUALIZE_PROMPT) {
    const error = new Error(`The prompt is too long. Keep it under ${MAX_VISUALIZE_PROMPT} characters.`);
    error.status = 400;
    throw error;
  }
  return prompt;
}
