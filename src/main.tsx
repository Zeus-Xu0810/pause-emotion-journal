import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/firebase';
import './styles.css';

/** 页面入口：认证状态由统一 Provider 提供，路由刷新由 Vercel 回退处理。 */
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></React.StrictMode>,
);
