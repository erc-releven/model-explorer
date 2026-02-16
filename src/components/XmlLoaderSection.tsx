import { type ChangeEvent } from "react";

interface XmlLoaderSectionProps {
  xmlUrlInput: string;
  isLoadingFromUrl: boolean;
  onXmlUrlInputChange: (value: string) => void;
  onUploadFile: (file: File) => Promise<void>;
  onLoadUrl: (url: string) => Promise<void>;
}

export function XmlLoaderSection({
  xmlUrlInput,
  isLoadingFromUrl,
  onXmlUrlInputChange,
  onUploadFile,
  onLoadUrl,
}: XmlLoaderSectionProps) {
  return (
    <section className="mt-3 w-full max-w-3xl rounded-xl border border-neutral-300 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 hover:bg-neutral-50">
          <span>Upload XML</span>
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            className="w-[13rem] text-xs text-neutral-700 file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-neutral-200 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-neutral-700 hover:file:bg-neutral-300"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) {
                return;
              }
              void (async () => {
                try {
                  await onUploadFile(file);
                } finally {
                  input.value = "";
                }
              })();
            }}
          />
        </label>

        <div className="flex min-w-[20rem] items-center gap-2">
          <input
            type="url"
            placeholder="https://example.org/graph.xml"
            value={xmlUrlInput}
            onChange={(event) => {
              onXmlUrlInputChange(event.target.value);
            }}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
          />
          <button
            type="button"
            disabled={isLoadingFromUrl || xmlUrlInput.trim().length === 0}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              void onLoadUrl(xmlUrlInput.trim());
            }}
          >
            {isLoadingFromUrl ? "Loading..." : "Load URL"}
          </button>
        </div>
      </div>
    </section>
  );
}
