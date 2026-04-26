require('dotenv').config(); // Carga las variables del .env para evitar el error de headers
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  // Validación de seguridad para el Token
  if (!process.env.FINA_TOKEN) {
    console.error("❌ ERROR: FINA_TOKEN no definido. Verifica tu archivo .env.");
    return;
  }

  console.log("📡 Conectando con la API de Fina (Estructura de Canal de Ventas)...");
  
  try {
    const response = await fetch('https://api.finapartner.com/api/pos/sales/69ee728889942f65ea447c4e?hideOutOfStock=true&location=local', {
      headers: { 
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json',
        'Origin': 'https://bbtiendadelicores.finapartner.com',
        'Referer': 'https://bbtiendadelicores.finapartner.com/'
      }
    });

    const json = await response.json();
    
    // Accedemos a los productos según la nueva estructura 
    const productosFina = json.data?.salesChannel?.products;

    if (!productosFina || productosFina.length === 0) {
      console.log("⚠️ No se encontraron productos en data.salesChannel.products");
      return;
    }

    console.log(`📦 Encontrados ${productosFina.length} productos en Fina.`);

    // --- PASO 1: Procesar Categorías ---
    const categoriasUnicas = new Map();
    
    productosFina.forEach(p => {
      // Si la categoría está vacía, usamos 'Sin Categoría' [cite: 5904]
      const nombre = (p.category && p.category.trim() !== "") ? p.category.trim() : 'Sin Categoría';
      const slug = nombre.toLowerCase()
                         .replace(/\s+/g, '-')
                         .replace(/[^a-z0-9-]/g, '');
      
      if (!categoriasUnicas.has(slug)) {
        categoriasUnicas.set(slug, nombre);
      }
    });

    const arrayCategorias = Array.from(categoriasUnicas).map(([slug, nombre]) => ({
      nombre,
      slug
    }));

    console.log(`📂 Sincronizando ${arrayCategorias.length} categorías...`);
    const { data: finalCats, error: catError } = await supabase
      .from('categorias')
      .upsert(arrayCategorias, { onConflict: 'slug' })
      .select();

    if (catError) throw catError;

    const catMap = {};
    finalCats.forEach(c => {
      catMap[c.nombre.toLowerCase().trim()] = c.id;
    });

    // --- PASO 2: Procesar Productos ---
    const updates = productosFina.map(prod => {
      const nombreCatKey = (prod.category && prod.category.trim() !== "") 
                           ? prod.category.toLowerCase().trim() 
                           : 'sin categoría';

      return {
        // Usamos SKU si existe, si no, el _id único de Fina [cite: 21, 26]
        sku: (prod.SKU && prod.SKU !== "") ? prod.SKU : prod._id, 
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: prod.sellingPrice || 0,
        stock: prod.totalStock || 0,
        categoria_id: catMap[nombreCatKey],
        actualizado_en: new Date().toISOString()
      };
    });

    console.log(`📤 Actualizando ${updates.length} productos en Supabase...`);
    
    const { error: prodError } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (prodError) throw prodError;
    
    console.log("✅ ¡Sincronización exitosa!");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();
