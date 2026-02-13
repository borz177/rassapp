import React, { useState } from 'react';
import { Product } from '../types';
import { ICONS } from '../constants';
import { suggestProductDescription } from '../services/geminiService';

interface ProductsProps {
  products: Product[];
  onAddProduct: (name: string, price: number, stock: number) => void;
  onUpdateProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
}

const Products: React.FC<ProductsProps> = ({ products, onAddProduct, onUpdateProduct, onDeleteProduct }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', price: '', stock: '' });

  const handleStartEdit = (p: Product) => {
    setEditingId(p.id);
    setEditForm(p);
  };

  const handleSaveEdit = () => {
    if (editingId && editForm.name && editForm.price) {
      onUpdateProduct(editForm as Product);
      setEditingId(null);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addForm.name && addForm.price) {
        // Optional: Trigger AI description generation in background if needed, 
        // but for now we just add it to keep UI responsive.
        onAddProduct(addForm.name, Number(addForm.price), Number(addForm.stock) || 0);
        setAddForm({ name: '', price: '', stock: '' });
        setIsAdding(false);
    }
  };

  const handleDeleteClick = (id: string) => {
      if(window.confirm("Вы уверены, что хотите удалить этот товар?")) {
          onDeleteProduct(id);
      }
  }

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <header className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Склад</h2>
            <p className="text-slate-500 text-sm">Управление товарами</p>
        </div>
        <button 
            onClick={() => setIsAdding(!isAdding)} 
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-200"
        >
            {isAdding ? ICONS.Close : ICONS.AddSmall} {isAdding ? 'Отмена' : 'Добавить'}
        </button>
      </header>

      {isAdding && (
          <form onSubmit={handleAddSubmit} className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm space-y-3 animate-fade-in">
              <h3 className="font-bold text-sm text-indigo-800">Новый товар</h3>
              <input 
                placeholder="Название" 
                className="w-full p-3 border border-slate-200 rounded-lg outline-none"
                value={addForm.name}
                onChange={e => setAddForm({...addForm, name: e.target.value})}
                required
              />
              <div className="flex gap-2">
                <input 
                    type="number"
                    placeholder="Цена (₽)" 
                    className="flex-1 p-3 border border-slate-200 rounded-lg outline-none"
                    value={addForm.price}
                    onChange={e => setAddForm({...addForm, price: e.target.value})}
                    required
                />
                <input 
                    type="number"
                    placeholder="Кол-во" 
                    className="w-24 p-3 border border-slate-200 rounded-lg outline-none"
                    value={addForm.stock}
                    onChange={e => setAddForm({...addForm, stock: e.target.value})}
                />
              </div>
              <button type="submit" className="w-full py-3 bg-indigo-600 text-white rounded-lg font-bold">Сохранить</button>
          </form>
      )}

      <div className="grid gap-4">
        {products.map(p => (
            <div key={p.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                {editingId === p.id ? (
                    <div className="space-y-3">
                        <input 
                            className="w-full p-2 border border-slate-300 rounded"
                            value={editForm.name}
                            onChange={e => setEditForm({...editForm, name: e.target.value})}
                        />
                        <div className="flex gap-2">
                             <input 
                                type="number"
                                className="flex-1 p-2 border border-slate-300 rounded"
                                value={editForm.price}
                                onChange={e => setEditForm({...editForm, price: Number(e.target.value)})}
                             />
                             <input 
                                type="number"
                                className="w-20 p-2 border border-slate-300 rounded"
                                value={editForm.stock}
                                onChange={e => setEditForm({...editForm, stock: Number(e.target.value)})}
                             />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditingId(null)} className="px-3 py-1 text-slate-500 text-sm">Отмена</button>
                            <button onClick={handleSaveEdit} className="px-3 py-1 bg-emerald-500 text-white rounded text-sm">OK</button>
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="font-bold text-slate-800">{p.name}</h3>
                            <p className="text-emerald-600 font-semibold">{p.price.toLocaleString()} ₽</p>
                            <p className="text-xs text-slate-400">На складе: {p.stock} шт.</p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => handleStartEdit(p)} className="p-2 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100">
                                {ICONS.Edit}
                            </button>
                            <button onClick={() => handleDeleteClick(p.id)} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
                                {ICONS.Delete}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        ))}
      </div>
    </div>
  );
};

export default Products;
