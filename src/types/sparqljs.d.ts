declare module "sparqljs" {
  export class Parser {
    parse(input: string): unknown;
  }

  export class Generator {
    stringify(query: unknown): string;
  }
}
