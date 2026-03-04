export const TYPE_PREFIXES: Array<{ prefix: string; iri: string }> = [
  { prefix: "aaao", iri: "https://ontology.swissartresearch.net/aaao/" },
  { prefix: "crm", iri: "http://www.cidoc-crm.org/cidoc-crm/" },
  { prefix: "lrmoo", iri: "http://iflastandards.info/ns/lrm/lrmoo/" },
  { prefix: "owl", iri: "http://www.w3.org/2002/07/owl#" },
  { prefix: "rdfschema", iri: "http://www.w3.org/2000/01/rdf-schema#" },
  { prefix: "star", iri: "https://r11.eu/ns/star/" },
  { prefix: "skos", iri: "http://www.w3.org/2004/02/skos/core#" },
  { prefix: "r11", iri: "https://r11.eu/ns/spec/" },
  { prefix: "r11pros", iri: "https://r11.eu/ns/prosopography/" },
  { prefix: "pwro", iri: "https://ontology.swissartresearch.net/pwro/" },
];

export function abbreviateType(value: string): string {
  for (const entry of TYPE_PREFIXES) {
    if (value.startsWith(entry.iri)) {
      return `${entry.prefix}:${value.slice(entry.iri.length)}`;
    }
  }
  return value;
}
