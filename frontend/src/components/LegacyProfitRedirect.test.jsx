// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { expect, it } from "vitest";
import LegacyProfitRedirect from "./LegacyProfitRedirect";

function Target() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output>{location.pathname + location.search + location.hash}</output><button onClick={() => navigate(-1)}>返回</button></>;
}
it("旧利润书签保留所有查询和锚点，并替换旧历史记录", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/products", "/profit?ledger=L&q=中文&supplier=A&supplier=B#details"]}><Routes>
      <Route path="/profit" element={<LegacyProfitRedirect />} /><Route path="*" element={<Target />} />
    </Routes></MemoryRouter>));
    expect(container.querySelector("output").textContent).toBe("/workspace?ledger=L&q=中文&supplier=A&supplier=B#details");
    await act(async () => container.querySelector("button").click());
    expect(container.querySelector("output").textContent).toBe("/products");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
