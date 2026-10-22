import React from "react";
import type {
  ContractData,
  ContractTemplateId,
} from "../src/contractTemplates";
import { buildContractHtml } from "../src/contractTemplates";

/** Предпросмотр договора: тот же HTML, из которого собираются печать и PDF. */
export default function ContractPreviewFrame({
  template,
  data,
  title = "Предпросмотр договора",
}: {
  template: ContractTemplateId;
  data: ContractData;
  title?: string;
}) {
  return (
    <iframe
      title={title}
      srcDoc={buildContractHtml(template, data)}
      sandbox="allow-scripts"
      className="w-full h-full border-0 bg-white"
    />
  );
}
