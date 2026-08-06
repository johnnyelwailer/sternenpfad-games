export type GameManifest = {
  id: string;
  title: string;
  sourceRoot: string;
  assetRoot: string;
  testCommand: string;
  locales: string[];
  realms: string[];
  concepts: string[];
};
