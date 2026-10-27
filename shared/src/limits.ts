/** YouTube title character limit. */
export const YT_TITLE_MAX = 100;

/** YouTube description character limit. */
export const YT_DESCRIPTION_MAX = 5000;

export function charWarning(title: string, description: string): { titleOver: boolean; descOver: boolean } {
  return {
    titleOver: title.length > YT_TITLE_MAX,
    descOver: description.length > YT_DESCRIPTION_MAX,
  };
}
