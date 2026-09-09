import { Navigate, useLocation } from "react-router-dom";

export default function LegacyProfitRedirect() {
  const { search, hash } = useLocation();
  return <Navigate replace to={{ pathname: "/workspace", search, hash }} />;
}
