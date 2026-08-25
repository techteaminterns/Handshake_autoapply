import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ApplyProvider } from './context/ApplyContext';
import JobDetailsPage from './pages/JobDetailsPage';
import ApplyPage from './pages/ApplyPage';
import DonePage from './pages/DonePage';

export default function App() {
  return (
    <ApplyProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/job/1" replace />} />
          <Route path="/job/:jobId" element={<JobDetailsPage />} />
          <Route path="/apply/:jobId" element={<ApplyPage />} />
          <Route path="/done" element={<DonePage />} />
          <Route path="*" element={<Navigate to="/job/1" replace />} />
        </Routes>
      </BrowserRouter>
    </ApplyProvider>
  );
}
