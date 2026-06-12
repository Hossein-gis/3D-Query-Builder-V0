'use client';

import React from 'react';
import { useQueryStore } from '../store/useQueryStore';
import { historyService } from '../lib/history';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Edit, Trash2, Download, ZoomIn } from 'lucide-react';

export default function SearchHistoryPanel() {
  const { history, toggleLayer, removeFromHistory, renameEntry, zoomToResult } = useQueryStore();

  return (
    <div className="border-l border-border bg-card p-4 w-80 overflow-auto">
      <h2 className="font-semibold mb-4 text-lg">تاریخچه جستجوها</h2>
      
      {history.length === 0 ? (
        <p className="text-muted-foreground text-sm">هنوز جستجویی ثبت نشده</p>
      ) : (
        <div className="space-y-3">
          {history.map((entry) => (
            <div key={entry.id} className="border rounded-lg p-3 bg-background">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-medium text-sm">{entry.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {entry.rowCount} ویژگی • {new Date(entry.createdAt).toLocaleTimeString('fa-IR')}
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">{entry.table.split('.').pop()}</Badge>
              </div>

              <div className="flex gap-1 flex-wrap">
                <Button 
                  size="sm" 
                  variant={entry.visible ? "default" : "outline"}
                  onClick={() => toggleLayer(entry.id)}
                >
                  {entry.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                
                <Button size="sm" variant="outline" onClick={() => zoomToResult(entry.id)}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                
                <Button size="sm" variant="outline" onClick={() => {
                  const newName = prompt('نام جدید:', entry.name);
                  if (newName) renameEntry(entry.id, newName);
                }}>
                  <Edit className="h-4 w-4" />
                </Button>
                
                <Button size="sm" variant="outline" onClick={() => {
                  const geojson = {
                    type: 'FeatureCollection',
                    features: [] 
                  };
                  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${entry.name}.geojson`;
                  a.click();
                }}>
                  <Download className="h-4 w-4" />
                </Button>
                
                <Button size="sm" variant="destructive" onClick={() => removeFromHistory(entry.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}