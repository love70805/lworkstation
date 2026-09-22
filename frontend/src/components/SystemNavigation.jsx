import { NavLink } from 'react-router-dom';
import { Activity, ShieldCheck } from 'lucide-react';

export default function SystemNavigation() {
  return <nav className="system-navigation" aria-label="系统与备份">
    <NavLink to="/diagnostics"><Activity size={17} />系统检查</NavLink>
    <NavLink to="/data-security"><ShieldCheck size={17} />数据备份</NavLink>
  </nav>;
}
