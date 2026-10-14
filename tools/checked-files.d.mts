export declare function sampleDocs(root: string): string[];
export declare function checkedDocs(root: string): string[];
export declare const PACK_REQUIRED: readonly string[];
export interface Fence { readonly lang: string; readonly line: number; readonly code: string }
export interface Sample { readonly doc: string; readonly line: number; readonly code: string }
export declare const SAMPLE_LANGUAGES: readonly string[];
export declare const CODE_LANGUAGE: RegExp;
export declare function fencesOf(markdown: string): Fence[];
export declare function samplesOf(doc: string, markdown: string): Sample[];
export declare function docSamples(root: string): Sample[];
