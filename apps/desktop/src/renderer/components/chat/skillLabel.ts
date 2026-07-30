export function formatSkillLabel(name: string) {
  const [namespace, ...rest] = name.split(":");
  if (rest.length === 0) {
    return titleCaseSkillName(namespace);
  }

  return `${titleCaseSkillName(namespace)}: ${titleCaseSkillName(rest.join(":"))}`;
}

function titleCaseSkillName(name: string) {
  return name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "ui") return "UI";
      if (part.toLowerCase() === "ux") return "UX";
      if (part.toLowerCase() === "pdf") return "PDF";
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}
