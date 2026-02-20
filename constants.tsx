
import React, { ReactNode } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Package, 
  CreditCard, 
  Sparkles, 
  Plus, 
  Trash2, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  Menu,
  X,
  Send,
  RefreshCw,
  MoreHorizontal,
  FileText,
  Settings,
  Wallet,
  TrendingDown,
  TrendingUp,
  List,
  Edit2,
  ArrowLeft,
  Briefcase,
  Handshake,
  Crown
} from 'lucide-react';

export const ICONS: Record<string, ReactNode> = {
  Dashboard: <LayoutDashboard size={20} />,
  Customers: <Users size={20} />,
  Users: <Users size={20} />,
  Products: <Package size={20} />,
  Sales: <CreditCard size={20} />,
  AI: <Sparkles size={20} />,
  Add: <Plus size={24} />, // Bigger for FAB
  AddSmall: <Plus size={18} />,
  Delete: <Trash2 size={16} />,
  Edit: <Edit2 size={16} />,
  Check: <CheckCircle size={16} />,
  Clock: <Clock size={16} />,
  Alert: <AlertTriangle size={16} />,
  Menu: <Menu size={24} />,
  Close: <X size={24} />,
  Back: <ArrowLeft size={24} />,
  Send: <Send size={16} />,
  Refresh: <RefreshCw size={16} />,
  More: <MoreHorizontal size={20} />,
  File: <FileText size={20} />,
  Settings: <Settings size={20} />,
  Wallet: <Wallet size={20} />,
  Income: <TrendingUp size={20} />,
  Expense: <TrendingDown size={20} />,
  TrendingUp: <TrendingUp size={20} />,
  List: <List size={20} />,
  Employees: <Briefcase size={20} />,
  Partners: <Handshake size={20} />,
  Tariffs: <Crown size={20} />
};

export const APP_NAME = "FinUchet";
export const APP_VERSION = "1.0.3";
