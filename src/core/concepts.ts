/**
 * DAU curriculum concept references.
 *
 * Concept IDs are kebab-case strings owned by canonical DAU
 * (anil-ganti-nbc/idle-time-learning-doodad, src/content/curriculum/data).
 * The World Generator never invents concept ids; it references them so every
 * world carries provenance back to the curriculum. Validation fails a world
 * that references an unknown id when checked against a catalog snapshot.
 */

export interface ConceptRef {
  /** DAU concept id, e.g. "cpu-cache-miss". */
  id: string;
  /** DAU tier (0–5) copied from the curriculum at generation time. */
  tier: number;
}

/** Minimal shape of a DAU course-manifest concept for validation purposes. */
export interface CatalogConcept {
  id: string;
  tier: number;
  prerequisites: string[];
  courseId?: string;
}

export interface ConceptCatalog {
  concepts: Record<string, CatalogConcept>;
}

export function catalogFromManifests(
  courses: Array<{ id: string; concepts: Array<{ id: string; tier: number; prerequisites: string[] }> }>,
): ConceptCatalog {
  const concepts: Record<string, CatalogConcept> = {};
  for (const course of courses) {
    for (const c of course.concepts) {
      concepts[c.id] = { id: c.id, tier: c.tier, prerequisites: c.prerequisites, courseId: course.id };
    }
  }
  return { concepts };
}
